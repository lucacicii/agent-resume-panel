// @vitest-environment node
import * as fs from "node:fs/promises";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { XMLValidator } from "fast-xml-parser";
import {
  createWebdavSession,
  describeTransportError,
  normalizeWebdavConfig,
  parseMultistatus,
  WebdavError,
  type WebdavConfig
} from "./webdavClient";

/**
 * The client talks plain HTTP to a throwaway server on localhost. That keeps the
 * protocol assertions honest: real verbs, real status codes, real XML.
 */
type Handler = (request: http.IncomingMessage, response: http.ServerResponse, body: Buffer) => void;

interface FakeServer {
  url: string;
  requests: Array<{ method: string; path: string; headers: http.IncomingHttpHeaders }>;
  close(): Promise<void>;
}

const servers: FakeServer[] = [];
const tempDirs: string[] = [];

async function startServer(handler: Handler, options: { requireAuth?: boolean } = {}): Promise<FakeServer> {
  const requests: FakeServer["requests"] = [];
  const server = http.createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      requests.push({ method: request.method ?? "", path: request.url ?? "", headers: request.headers });
      if (options.requireAuth) {
        const expected = `Basic ${Buffer.from("user:secret").toString("base64")}`;
        if (request.headers.authorization !== expected) {
          response.writeHead(401).end("unauthorized");
          return;
        }
      }
      handler(request, response, Buffer.concat(chunks));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  const fake: FakeServer = {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  };
  servers.push(fake);
  return fake;
}

async function tempFile(contents: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-resume-webdav-test-"));
  tempDirs.push(dir);
  const file = path.join(dir, "payload.bin");
  await fs.writeFile(file, contents);
  return file;
}

/**
 * Same lifecycle as startServer, but hands the request over before the body is
 * read so a test can drop the socket in the middle of an upload.
 */
async function startRawServer(handler: (request: http.IncomingMessage, response: http.ServerResponse) => void): Promise<FakeServer> {
  const requests: FakeServer["requests"] = [];
  const server = http.createServer((request, response) => {
    requests.push({ method: request.method ?? "", path: request.url ?? "", headers: request.headers });
    handler(request, response);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  const fake: FakeServer = {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  };
  servers.push(fake);
  return fake;
}

function configFor(url: string, folder = "Agent Resume/Backups"): WebdavConfig {
  return normalizeWebdavConfig({ url, username: "user", password: "secret", folder });
}

function multistatus(entries: Array<{ href: string; collection?: boolean; size?: number; mtime?: string }>): string {
  const body = entries.map((entry) => `<d:response><d:href>${entry.href}</d:href><d:propstat><d:prop>${
    entry.collection ? "<d:resourcetype><d:collection/></d:resourcetype>" : "<d:resourcetype/>"
  }${entry.size === undefined ? "" : `<d:getcontentlength>${entry.size}</d:getcontentlength>`}${
    entry.mtime ? `<d:getlastmodified>${entry.mtime}</d:getlastmodified>` : ""
  }</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`).join("");
  return `<?xml version="1.0" encoding="utf-8"?><d:multistatus xmlns:d="DAV:">${body}</d:multistatus>`;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("normalizeWebdavConfig", () => {
  it("strips trailing slashes, encodes nothing prematurely, and defaults the folder", () => {
    const config = normalizeWebdavConfig({ url: "https://dav.example.com/dav/", username: " user ", password: "p" });
    expect(config).toEqual({ url: "https://dav.example.com/dav", username: "user", password: "p", folder: "Agent Resume/Backups" });
  });

  it("rejects non-http schemes, embedded credentials, query strings, and traversal", () => {
    expect(() => normalizeWebdavConfig({ url: "ftp://example.com", username: "u" })).toThrow(WebdavError);
    expect(() => normalizeWebdavConfig({ url: "https://u:p@example.com", username: "u" })).toThrow(/credentials in the URL/);
    expect(() => normalizeWebdavConfig({ url: "https://example.com/dav?a=1", username: "u" })).toThrow(/query string/);
    expect(() => normalizeWebdavConfig({ url: "https://example.com", username: "" })).toThrow(/username/);
    expect(() => normalizeWebdavConfig({ url: "https://example.com", username: "u", folder: "../escape" })).toThrow(/'\.' or '\.\.'/);
  });
});

describe("createWebdavSession", () => {
  it("creates each folder segment and tolerates 405 for an existing one", async () => {
    const server = await startServer((request, response) => {
      if (request.method === "MKCOL") {
        response.writeHead(request.url?.endsWith("/Backups") ? 405 : 201).end();
        return;
      }
      response.writeHead(405).end();
    });
    await createWebdavSession(configFor(server.url)).ensureFolder();

    expect(server.requests.map((request) => [request.method, request.path])).toEqual([
      ["MKCOL", "/Agent%20Resume"],
      ["MKCOL", "/Agent%20Resume/Backups"]
    ]);
    expect(server.requests[0].headers.authorization).toBe(`Basic ${Buffer.from("user:secret").toString("base64")}`);
  });

  it("uploads with a known length and renames into place", async () => {
    const uploaded: Buffer[] = [];
    const server = await startServer((request, response, body) => {
      if (request.method === "PUT") {
        uploaded.push(body);
        response.writeHead(201).end();
        return;
      }
      if (request.method === "MOVE") {
        response.writeHead(201).end();
        return;
      }
      response.writeHead(405).end();
    });
    const file = await tempFile("payload-bytes");
    const session = createWebdavSession(configFor(server.url));
    await session.putFile(file, "backup.zip.partial");
    await session.moveFile("backup.zip.partial", "backup.zip");

    expect(uploaded[0]?.toString("utf8")).toBe("payload-bytes");
    const put = server.requests.find((request) => request.method === "PUT");
    expect(put?.headers["content-length"]).toBe("13");
    const move = server.requests.find((request) => request.method === "MOVE");
    expect(move?.headers.destination).toBe(`${server.url}/Agent%20Resume/Backups/backup.zip`);
  });

  it("reports upload progress in real bytes and still sends the whole file", async () => {
    const uploaded: Buffer[] = [];
    const server = await startServer((request, response, body) => {
      if (request.method === "PUT") {
        uploaded.push(body);
        response.writeHead(201).end();
        return;
      }
      response.writeHead(405).end();
    });
    const contents = "x".repeat(256 * 1024);
    const file = await tempFile(contents);
    const reports: Array<{ sent: number; total: number }> = [];
    await createWebdavSession(configFor(server.url)).putFile(file, "backup.zip.partial", (sent, total) => {
      reports.push({ sent, total });
    });

    expect(uploaded[0]?.toString("utf8")).toBe(contents);
    // Streaming still announces the exact length: some servers answer a
    // chunked PUT with 411 instead of accepting it.
    const put = server.requests.find((request) => request.method === "PUT");
    expect(put?.headers["content-length"]).toBe(String(contents.length));
    expect(reports.length).toBeGreaterThan(0);
    expect(reports[reports.length - 1]).toEqual({ sent: contents.length, total: contents.length });
    // Percent is monotonic, so the bar never jumps backwards.
    const percents = reports.map((report) => Math.floor((report.sent / report.total) * 100));
    expect(percents).toEqual([...percents].sort((left, right) => left - right));
  });

  it("parses a multistatus listing and drops the collection itself", async () => {
    const server = await startServer((_request, response) => {
      response.writeHead(207, { "Content-Type": "application/xml" }).end(multistatus([
        { href: "/Agent%20Resume/Backups/", collection: true },
        { href: "/Agent%20Resume/Backups/agent-resume-a.zip", size: 2048, mtime: "Wed, 01 Oct 2025 10:00:00 GMT" },
        { href: "/Agent%20Resume/Backups/%E4%B8%AD%E6%96%87.zip", size: 10 }
      ]));
    });
    const entries = await createWebdavSession(configFor(server.url)).propfind(1);

    expect(entries).toEqual([
      { name: "agent-resume-a.zip", isCollection: false, size: 2048, mtimeMs: Date.parse("Wed, 01 Oct 2025 10:00:00 GMT") },
      { name: "中文.zip", isCollection: false, size: 10, mtimeMs: 0 }
    ]);
  });

  it("sends a PROPFIND body that is well-formed XML", async () => {
    // Servers such as Jianguoyun answer a malformed body with 400, which the
    // in-memory fake accepted silently, so validate the body itself.
    let body = "";
    const server = await startServer((_request, response, raw) => {
      body = raw.toString("utf8");
      response.writeHead(207, { "Content-Type": "application/xml" }).end(multistatus([]));
    });
    await createWebdavSession(configFor(server.url)).propfind(1);

    expect(XMLValidator.validate(body)).toBe(true);
    expect(body).not.toContain("dav:");
  });

  it("returns null from a ranged read when the server ignores Range", async () => {
    const server = await startServer((_request, response) => {
      response.writeHead(200, { "Content-Length": "1000" }).end(Buffer.alloc(1000));
    });
    await expect(createWebdavSession(configFor(server.url)).readRange("a.zip", 0, 9)).resolves.toBeNull();
  });

  it("reads a byte range and streams a whole file to disk", async () => {
    const contents = Buffer.from("0123456789");
    const server = await startServer((request, response) => {
      if (request.method === "GET" && request.headers.range === "bytes=2-5") {
        response.writeHead(206, { "Content-Range": "bytes 2-5/10", "Content-Length": "4" }).end(contents.subarray(2, 6));
        return;
      }
      if (request.method === "GET") {
        response.writeHead(200, { "Content-Length": String(contents.length) }).end(contents);
        return;
      }
      response.writeHead(405).end();
    });
    const session = createWebdavSession(configFor(server.url));

    await expect(session.readRange("a.zip", 2, 5)).resolves.toMatchObject({ body: contents.subarray(2, 6), contentRange: "bytes 2-5/10" });

    const destination = path.join((await fs.mkdtemp(path.join(os.tmpdir(), "agent-resume-webdav-test-"))), "out.bin");
    tempDirs.push(path.dirname(destination));
    const progress: number[] = [];
    await session.getToFile("a.zip", destination, (bytes) => progress.push(bytes));
    await expect(fs.readFile(destination)).resolves.toEqual(contents);
    expect(progress.at(-1)).toBe(contents.length);
  });

  it("deletes a file and treats a missing file as already gone", async () => {
    const server = await startServer((request, response) => {
      response.writeHead(request.url?.includes("missing") ? 404 : 204).end();
    });
    const session = createWebdavSession(configFor(server.url));
    await expect(session.deleteFile("a.zip")).resolves.toBeUndefined();
    await expect(session.deleteFile("missing.zip")).resolves.toBeUndefined();
  });

  it("reports a readable 401 without leaking the password", async () => {
    const server = await startServer((_request, response) => response.writeHead(401).end(), { requireAuth: true });
    const session = createWebdavSession(configFor(server.url));
    const error = await session.propfind(1).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(WebdavError);
    expect((error as WebdavError).status).toBe(401);
    expect((error as WebdavError).message).toMatch(/authentication failed/i);
    expect((error as WebdavError).message).not.toContain("secret");
  });

  it("maps a refused connection to a readable message", async () => {
    const server = await startServer((_request, response) => response.writeHead(200).end());
    const url = server.url;
    await server.close();
    servers.splice(servers.indexOf(server), 1);

    const error = await createWebdavSession(configFor(url)).propfind(1).catch((caught: unknown) => caught);
    expect((error as WebdavError).message).toMatch(/refused the connection|could not reach/i);
    expect((error as WebdavError).message).not.toContain("secret");
  });

  it("names a mid-upload connection drop instead of reporting an unreachable server", async () => {
    const server = await startRawServer((request, response) => {
      let received = 0;
      request.on("data", (chunk: Buffer) => {
        received += chunk.length;
        if (received >= 64 * 1024) request.socket.destroy();
      });
      request.on("end", () => response.writeHead(201).end());
    });
    const file = await tempFile("x".repeat(512 * 1024));
    const session = createWebdavSession(configFor(server.url));

    // The backup path always listens for progress, which makes the client count
    // the bytes it has sent so a failed upload can report them.
    const error = await session.putFile(file, "big.zip", () => undefined).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(WebdavError);
    expect((error as WebdavError).message).toMatch(/connection .*closed while uploading big\.zip/i);
    expect((error as WebdavError).message).toMatch(/EPIPE|UND_ERR_SOCKET|ECONNRESET/);
    expect((error as WebdavError).message).toMatch(/of 512 KB sent/);
    expect((error as WebdavError).message).not.toMatch(/Could not reach/);
    // The transfer is retried once, then reported.
    expect(server.requests.filter((request) => request.method === "PUT")).toHaveLength(2);
  });

  it("retries a dropped upload once and finishes it", async () => {
    let putAttempts = 0;
    const server = await startRawServer((request, response) => {
      const attempt = ++putAttempts;
      let received = 0;
      request.on("data", (chunk: Buffer) => {
        received += chunk.length;
        if (attempt === 1 && received >= 32 * 1024) request.socket.destroy();
      });
      request.on("end", () => response.writeHead(201).end());
    });
    const file = await tempFile("y".repeat(256 * 1024));
    const session = createWebdavSession(configFor(server.url));

    await expect(session.putFile(file, "retry.zip")).resolves.toBeUndefined();
    expect(putAttempts).toBe(2);
  });

  it("does not retry an authentication failure on upload", async () => {
    const server = await startServer((_request, response) => response.writeHead(401).end(), { requireAuth: true });
    const file = await tempFile("z".repeat(1024));
    const session = createWebdavSession(configFor(server.url));

    const error = await session.putFile(file, "denied.zip").catch((caught: unknown) => caught);

    expect((error as WebdavError).message).toMatch(/authentication failed/i);
    expect(server.requests.filter((request) => request.method === "PUT")).toHaveLength(1);
  });
});

describe("describeTransportError", () => {
  const context = "uploading big.zip";

  it("separates a closed connection from an unreachable server", () => {
    const message = describeTransportError(
      { name: "TypeError", message: "fetch failed", cause: { name: "SocketError", code: "UND_ERR_SOCKET", message: "other side closed" } },
      "dav.example.com",
      context,
      12_000
    );
    expect(message).toMatch(/connection .*closed while uploading big\.zip/i);
    expect(message).not.toMatch(/Could not reach/);
  });

  it("reports a stalled upload as a timeout", () => {
    const message = describeTransportError(
      { name: "TypeError", message: "fetch failed", cause: { name: "HeadersTimeoutError", code: "UND_ERR_HEADERS_TIMEOUT", message: "Headers Timeout Error" } },
      "dav.example.com",
      context,
      301_000
    );
    expect(message).toMatch(/stopped responding while uploading big\.zip/);
  });

  it("keeps the underlying code in the fallback instead of dropping it", () => {
    const message = describeTransportError(
      { name: "TypeError", message: "fetch failed", cause: { name: "Error", code: "EIO", message: "i/o error" } },
      "dav.example.com",
      context,
      40
    );
    expect(message).toMatch(/Could not reach the WebDAV server at dav\.example\.com/);
    expect(message).toContain("EIO");
    expect(message).toContain("uploading big.zip");
  });

  it("walks an AggregateError to find the transport code", () => {
    const message = describeTransportError(
      { name: "TypeError", message: "fetch failed", cause: { name: "AggregateError", errors: [{ code: "ENETUNREACH", message: "no route" }] } },
      "dav.example.com",
      context,
      10
    );
    expect(message).toMatch(/no network route/i);
  });

  it("still names unresolved hosts, refusals, and certificates", () => {
    const host = "dav.example.com";
    expect(describeTransportError({ cause: { code: "ENOTFOUND" } }, host, context, 5)).toMatch(/Could not resolve/);
    expect(describeTransportError({ cause: { code: "ECONNREFUSED" } }, host, context, 5)).toMatch(/refused the connection/);
    expect(describeTransportError({ cause: { code: "ERR_TLS_CERT_ALTNAME_INVALID" } }, host, context, 5)).toMatch(/TLS certificate/);
  });
});

describe("parseMultistatus", () => {
  it("merges properties split across propstat blocks", () => {
    const xml = `<?xml version="1.0"?><D:multistatus xmlns:D="DAV:"><D:response>
      <D:href>/dav/Backups/one.zip</D:href>
      <D:propstat><D:prop><D:resourcetype/></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat>
      <D:propstat><D:prop><D:getcontentlength>42</D:getcontentlength></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat>
    </D:response></D:multistatus>`;
    expect(parseMultistatus(xml, "http://host/dav/Backups")).toEqual([
      { name: "one.zip", isCollection: false, size: 42, mtimeMs: 0 }
    ]);
  });

  it("returns nothing for a response without any resource", () => {
    expect(parseMultistatus("<multistatus/>", "http://host/dav")).toEqual([]);
  });
});
