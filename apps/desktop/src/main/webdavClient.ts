import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import { pipeline } from "node:stream/promises";
import { XMLParser } from "fast-xml-parser";

/**
 * Minimal WebDAV client: the six verbs a backup target needs.
 *
 * The `webdav` package is ESM-only and this runs in a CommonJS main process, so
 * the protocol surface is implemented here over the global `fetch`. No Electron
 * and no backup-domain types live in this file, which keeps it unit-testable
 * against a local HTTP server.
 */

export interface WebdavConfig {
  /** Base URL without a trailing slash, e.g. `https://dav.jianguoyun.com/dav`. */
  url: string;
  username: string;
  password: string;
  /** Folder below the base URL, e.g. `Agent Resume/Backups`. */
  folder: string;
}

export interface WebdavEntry {
  /** Entry name without any parent path. */
  name: string;
  isCollection: boolean;
  size: number;
  mtimeMs: number;
}

export interface WebdavSession {
  config: WebdavConfig;
  /** Absolute URL of the configured folder. */
  folderUrl: string;
  ensureFolder(): Promise<void>;
  putFile(localPath: string, remoteName: string, onBytes?: (sent: number, total: number) => void): Promise<void>;
  moveFile(fromName: string, toName: string): Promise<void>;
  propfind(depth: 0 | 1): Promise<WebdavEntry[]>;
  /** Single-range read. Returns `null` when the server ignored the range request. */
  readRange(remoteName: string, start: number, end?: number): Promise<{ body: Buffer; contentRange?: string } | null>;
  getToFile(remoteName: string, destination: string, onBytes?: (bytes: number, total: number) => void): Promise<void>;
  deleteFile(remoteName: string): Promise<void>;
  stat(remoteName: string): Promise<{ size: number } | null>;
}

const CONTROL_TIMEOUT_MS = 30_000;
const RANGE_TIMEOUT_MS = 20_000;
const TRANSFER_TIMEOUT_MS = 30 * 60_000;
/** Pause before the single retry of a transient transport failure. */
const RETRY_DELAY_MS = 750;
export const DEFAULT_WEBDAV_FOLDER = "Agent Resume/Backups";
const USER_AGENT = "Agent-Resume-Desktop";

export interface WebdavErrorOptions {
  /** The original fetch rejection, kept so the cause chain can be logged. */
  cause?: unknown;
  /** What the session was doing, e.g. `uploading backup.zip`. */
  context?: string;
  /** True when retrying the same request can plausibly succeed. */
  retryable?: boolean;
  /** The transport code from the underlying error (`EPIPE`, `UND_ERR_SOCKET`, …). */
  causeCode?: string;
}

/** Rejected before any network call; messages never echo the password. */
export class WebdavError extends Error {
  readonly context?: string;
  readonly retryable: boolean;
  readonly causeCode?: string;

  constructor(message: string, readonly status?: number, options: WebdavErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "WebdavError";
    this.context = options.context;
    this.retryable = options.retryable === true;
    this.causeCode = options.causeCode;
  }
}

export function normalizeWebdavConfig(input: {
  url?: unknown;
  username?: unknown;
  password?: unknown;
  folder?: unknown;
}): WebdavConfig {
  const rawUrl = typeof input.url === "string" ? input.url.trim() : "";
  if (!rawUrl) throw new WebdavError("Enter the WebDAV server URL.");
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new WebdavError("The WebDAV server URL is not valid.");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new WebdavError("The WebDAV server URL must start with https:// or http://.");
  }
  if (parsed.username || parsed.password) {
    throw new WebdavError("Do not put credentials in the URL; enter them in the username and password fields.");
  }
  if (parsed.search || parsed.hash) {
    throw new WebdavError("The WebDAV server URL must not contain a query string or fragment.");
  }

  const username = typeof input.username === "string" ? input.username.trim() : "";
  if (!username) throw new WebdavError("Enter the WebDAV username.");

  const rawFolder = typeof input.folder === "string" ? input.folder.trim() : "";
  const folder = sanitizeFolder(rawFolder || DEFAULT_WEBDAV_FOLDER);

  const base = `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, "");
  return {
    url: base,
    username,
    password: typeof input.password === "string" ? input.password : "",
    folder
  };
}

/** Reject absolute paths and `..` so a folder can never escape the base URL. */
function sanitizeFolder(value: string): string {
  const segments = value.split("/").map((segment) => segment.trim()).filter(Boolean);
  if (!segments.length) return DEFAULT_WEBDAV_FOLDER;
  if (segments.some((segment) => segment === "." || segment === "..")) {
    throw new WebdavError("The WebDAV folder must not contain '.' or '..'.");
  }
  return segments.join("/");
}

function encodeSegments(value: string): string {
  return value.split("/").map((segment) => encodeURIComponent(segment)).join("/");
}

function describeStatus(status: number, context: string): string {
  if (status === 401) return "WebDAV authentication failed. Check the username and app password.";
  if (status === 403) return `The WebDAV server refused ${context} (403). Check the folder permissions.`;
  if (status === 404) return `The WebDAV server could not find ${context} (404).`;
  if (status === 405) return `The WebDAV server does not allow ${context} (405).`;
  if (status === 409) return `The parent folder for ${context} is missing (409).`;
  if (status === 413) return `The WebDAV server rejected ${context} as too large (413).`;
  if (status === 423) return `The WebDAV server has ${context} locked (423). Try again later.`;
  if (status === 507) return `The WebDAV server is out of storage (507).`;
  return `The WebDAV server returned ${status} for ${context}.`;
}

async function toWebdavError(response: Response, context: string): Promise<WebdavError> {
  return new WebdavError(describeStatus(response.status, context), response.status, { context });
}

/** The connection died while bytes were moving; retrying is worthwhile. */
const CLOSED_CODES = new Set([
  "EPIPE",
  "ECONNRESET",
  "ECONNABORTED",
  "UND_ERR_SOCKET",
  "UND_ERR_CLOSED",
  "ERR_STREAM_PREMATURE_CLOSE"
]);
/** undici or the socket gave up: a stall, not a refusal. */
const TIMEOUT_CODES = new Set(["UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT", "ETIMEDOUT"]);
const CONNECT_TIMEOUT_CODES = new Set(["UND_ERR_CONNECT_TIMEOUT"]);
const UNREACHABLE_CODES = new Set(["ENETUNREACH", "EHOSTUNREACH", "ENETDOWN"]);

/** Transient enough that one retry is worth attempting. */
const RETRYABLE_CODES = new Set([...CLOSED_CODES, ...TIMEOUT_CODES, ...CONNECT_TIMEOUT_CODES]);

interface TransportCause {
  name?: string;
  code?: string;
  message?: string;
}

/**
 * Walk the wrapped errors undici produces (`fetch` -> `cause`, sometimes an
 * `AggregateError`) and return the first entry that carries a transport code.
 */
function transportCause(error: unknown): TransportCause {
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth += 1) {
    const node = current as {
      name?: unknown;
      code?: unknown;
      message?: unknown;
      cause?: unknown;
      errors?: unknown;
    };
    if (typeof node.code === "string") {
      return {
        ...(typeof node.name === "string" ? { name: node.name } : {}),
        code: node.code,
        ...(typeof node.message === "string" ? { message: node.message } : {})
      };
    }
    if (Array.isArray(node.errors)) {
      const nested = node.errors.find((item) => typeof (item as { code?: unknown } | undefined)?.code === "string");
      if (nested) {
        current = nested;
        continue;
      }
    }
    current = node.cause;
  }
  return {};
}

function isCertificateCode(code: string): boolean {
  return /^(ERR_TLS_|ERR_SSL_|CERT_)/.test(code)
    || code === "DEPTH_ZERO_SELF_SIGNED_CERT"
    || code === "SELF_SIGNED_CERT_IN_CHAIN"
    || code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE";
}

function formatElapsed(elapsedMs: number): string {
  if (elapsedMs < 10_000) return `${Math.max(1, Math.round(elapsedMs / 1000))}s`;
  if (elapsedMs < 60_000) return `${Math.round(elapsedMs / 1000)}s`;
  return `${Math.round(elapsedMs / 60_000)} min`;
}

/**
 * Map transport failures without ever including the request headers.
 *
 * Every branch keeps the operation and, for the catch-all, the underlying code,
 * so a failure says *what* broke instead of only that something did.
 */
export function describeTransportError(error: unknown, host: string, context: string, elapsedMs: number): string {
  const name = (error as { name?: string } | undefined)?.name;
  if (name === "TimeoutError" || name === "AbortError") {
    return `The WebDAV server at ${host} did not respond in time while ${context}.`;
  }
  const cause = transportCause(error);
  const code = cause.code;
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return `Could not resolve the WebDAV host ${host}.`;
  if (code === "ECONNREFUSED") return `The WebDAV server at ${host} refused the connection.`;
  if (code && CLOSED_CODES.has(code)) {
    return `The connection to the WebDAV server at ${host} closed while ${context} after ${formatElapsed(elapsedMs)} (${code}). Check the network, VPN, or proxy, then try again.`;
  }
  if (code && TIMEOUT_CODES.has(code)) {
    return `The WebDAV server at ${host} stopped responding while ${context} (${code}, after ${formatElapsed(elapsedMs)}).`;
  }
  if (code && CONNECT_TIMEOUT_CODES.has(code)) {
    return `Could not connect to the WebDAV server at ${host} while ${context} (${code}, timed out after ${formatElapsed(elapsedMs)}).`;
  }
  if (code && UNREACHABLE_CODES.has(code)) {
    return `There is no network route to the WebDAV server at ${host}. Check the VPN or proxy connection.`;
  }
  if (code && isCertificateCode(code)) {
    return `The TLS certificate for ${host} could not be verified. Use a certificate the system trusts.`;
  }
  const detail = [cause.name, code].filter(Boolean).join(" ");
  return `Could not reach the WebDAV server at ${host} while ${context} (${detail || cause.message || name || "unknown error"}).`;
}

function withTransferProgress(error: WebdavError, sent: number, total: number): WebdavError {
  const message = error.message.replace(/\.$/, "");
  return new WebdavError(`${message} (${formatBytes(sent)} of ${formatBytes(total)} sent).`, error.status, {
    ...(error.cause === undefined ? {} : { cause: error.cause }),
    ...(error.context === undefined ? {} : { context: error.context }),
    retryable: error.retryable,
    ...(error.causeCode === undefined ? {} : { causeCode: error.causeCode })
  });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseMtime(value: string | undefined): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function createWebdavSession(config: WebdavConfig): WebdavSession {
  const baseUrl = config.url.replace(/\/+$/, "");
  const folderUrl = `${baseUrl}/${encodeSegments(config.folder)}`;
  const host = new URL(baseUrl).host;
  const authorization = `Basic ${Buffer.from(`${config.username}:${config.password}`, "utf8").toString("base64")}`;

  const fileUrl = (name: string): string => `${folderUrl}/${encodeURIComponent(name)}`;

  const request = async (
    url: string,
    init: RequestInit,
    context: string,
    timeoutMs = CONTROL_TIMEOUT_MS,
    options: { retry?: boolean } = {}
  ): Promise<Response> => {
    // Bodyless and string-bodied requests can be replayed; a streamed PUT cannot,
    // so putFile opts out and retries by rebuilding its body.
    const attempts = options.retry === false ? 1 : 2;
    for (let attempt = 1; ; attempt += 1) {
      const startedAt = Date.now();
      try {
        return await fetch(url, {
          ...init,
          // A fresh signal per attempt: a retry must not inherit the previous deadline.
          signal: AbortSignal.timeout(timeoutMs),
          redirect: "manual",
          headers: {
            Authorization: authorization,
            "User-Agent": `${USER_AGENT}`,
            ...(init.headers as Record<string, string> | undefined)
          }
        });
      } catch (error) {
        const cause = transportCause(error);
        const retryable = cause.code !== undefined && RETRYABLE_CODES.has(cause.code);
        if (retryable && attempt < attempts) {
          await delay(RETRY_DELAY_MS);
          continue;
        }
        throw new WebdavError(
          describeTransportError(error, host, context, Date.now() - startedAt),
          undefined,
          {
            cause: error,
            context,
            retryable,
            ...(cause.code === undefined ? {} : { causeCode: cause.code })
          }
        );
      }
    }
  };

  const assertOk = async (response: Response, context: string, allowed: number[] = []): Promise<void> => {
    if (response.ok || allowed.includes(response.status)) return;
    // Drain the body so the socket is released before the error surfaces.
    await response.arrayBuffer().catch(() => undefined);
    throw await toWebdavError(response, context);
  };

  const ensureFolder = async (): Promise<void> => {
    const segments = config.folder.split("/").filter(Boolean);
    let current = baseUrl;
    for (const segment of segments) {
      current = `${current}/${encodeURIComponent(segment)}`;
      const response = await request(current, { method: "MKCOL" }, `creating ${segment}`);
      // 405 = already exists on most servers; 301/302 = redirected into place.
      await assertOk(response, `creating ${segment}`, [405, 301, 302]);
      await response.arrayBuffer().catch(() => undefined);
    }
  };

  const propfind = async (depth: 0 | 1): Promise<WebdavEntry[]> => {
    const response = await request(folderUrl, {
      method: "PROPFIND",
      headers: { Depth: String(depth), "Content-Type": "application/xml; charset=utf-8" },
      body: '<?xml version="1.0" encoding="utf-8"?><propfind xmlns="DAV:"><prop><resourcetype/><getcontentlength/><getlastmodified/></prop></propfind>'
    }, "listing the folder");
    await assertOk(response, "listing the folder");
    const text = await response.text();
    return parseMultistatus(text, folderUrl);
  };

  const readRange = async (remoteName: string, start: number, end?: number): Promise<{ body: Buffer; contentRange?: string } | null> => {
    const range = end === undefined ? `bytes=${start}-` : `bytes=${start}-${end}`;
    const response = await request(fileUrl(remoteName), { method: "GET", headers: { Range: range } }, `reading ${remoteName}`, RANGE_TIMEOUT_MS);
    if (response.status === 206) {
      const body = Buffer.from(await response.arrayBuffer());
      return { body, contentRange: response.headers.get("content-range") ?? undefined };
    }
    // 200 means the server ignored Range and is sending the whole file: abort.
    await response.body?.cancel().catch(() => undefined);
    if (response.status === 200) return null;
    await assertOk(response, `reading ${remoteName}`);
    return null;
  };

  const getToFile = async (remoteName: string, destination: string, onBytes?: (bytes: number, total: number) => void): Promise<void> => {
    const response = await request(fileUrl(remoteName), { method: "GET" }, `downloading ${remoteName}`, TRANSFER_TIMEOUT_MS);
    await assertOk(response, `downloading ${remoteName}`);
    if (!response.body) throw new WebdavError(`The WebDAV server returned an empty download for ${remoteName}.`);
    const total = Number(response.headers.get("content-length") ?? 0);
    await fsp.mkdir(path.dirname(destination), { recursive: true });
    let received = 0;
    // Same whole-percent throttle as the upload path.
    let lastPercent = -1;
    const counter = new (await import("node:stream")).Transform({
      transform(chunk: Buffer, _encoding, callback) {
        received += chunk.length;
        if (onBytes) {
          const percent = total > 0 ? Math.min(100, Math.floor((received / total) * 100)) : 100;
          if (percent !== lastPercent) {
            lastPercent = percent;
            onBytes(received, total);
          }
        }
        callback(null, chunk);
      }
    });
    await pipeline(response.body as unknown as NodeJS.ReadableStream, counter, fs.createWriteStream(destination, { mode: 0o600 }));
  };

  const stat = async (remoteName: string): Promise<{ size: number } | null> => {
    const response = await request(fileUrl(remoteName), { method: "HEAD" }, `reading ${remoteName}`, RANGE_TIMEOUT_MS);
    if (response.status === 404) {
      await response.arrayBuffer().catch(() => undefined);
      return null;
    }
    await assertOk(response, `reading ${remoteName}`);
    const size = Number(response.headers.get("content-length") ?? 0);
    await response.arrayBuffer().catch(() => undefined);
    return { size };
  };

  const putFile = async (localPath: string, remoteName: string, onBytes?: (sent: number, total: number) => void): Promise<void> => {
    const info = await fsp.stat(localPath);
    const url = fileUrl(remoteName);
    const context = `uploading ${remoteName}`;
    // Furthest byte count across attempts, so the error describes how far the
    // transfer actually got rather than the last (possibly instant) failure.
    let furthestSent = 0;
    // A dropped connection must not lose a long upload: rebuild the stream and
    // send it once more. The remote name is stable, so a retry overwrites the
    // partial file instead of leaving a second copy behind.
    for (let attempt = 1; ; attempt += 1) {
      let sent = 0;
      const body = await openBody(localPath, info.size, onBytes
        ? (bytes, total) => {
            sent = bytes;
            onBytes(bytes, total);
          }
        : undefined);
      try {
        const response = await request(url, {
          method: "PUT",
          body: body.value,
          headers: { "Content-Type": "application/octet-stream", "Content-Length": String(info.size) },
          // Only needed for the streaming body; harmless otherwise.
          ...(body.duplex ? { duplex: "half" } : {})
        } as RequestInit, context, TRANSFER_TIMEOUT_MS, { retry: false });
        await assertOk(response, context);
        await response.arrayBuffer().catch(() => undefined);
        return;
      } catch (error) {
        furthestSent = Math.max(furthestSent, sent);
        const retryable = error instanceof WebdavError && error.retryable;
        if (retryable && attempt === 1) {
          onBytes?.(0, info.size);
          await delay(RETRY_DELAY_MS);
          continue;
        }
        if (error instanceof WebdavError && furthestSent > 0) throw withTransferProgress(error, furthestSent, info.size);
        throw error;
      } finally {
        // A failed or aborted PUT must not leave the file handle open.
        body.dispose?.();
      }
    }
  };

  const moveFile = async (fromName: string, toName: string): Promise<void> => {
    const response = await request(fileUrl(fromName), {
      method: "MOVE",
      headers: { Destination: fileUrl(toName), Overwrite: "T" }
    }, `renaming ${fromName}`);
    await assertOk(response, `renaming ${fromName}`);
    await response.arrayBuffer().catch(() => undefined);
  };

  const deleteFile = async (remoteName: string): Promise<void> => {
    const response = await request(fileUrl(remoteName), { method: "DELETE" }, `deleting ${remoteName}`);
    await assertOk(response, `deleting ${remoteName}`, [404]);
    await response.arrayBuffer().catch(() => undefined);
  };

  return { config, folderUrl, ensureFolder, putFile, moveFile, propfind, readRange, getToFile, deleteFile, stat };
}

/**
 * Build the PUT body.
 *
 * A Blob gives fetch a known Content-Length without `duplex`, but it reports
 * nothing while it streams. When the caller wants progress, the file is streamed
 * through a counting Transform instead and the request is marked half-duplex.
 * Either way the byte counts are real: nothing is estimated.
 */
async function openBody(
  localPath: string,
  size: number,
  onBytes?: (sent: number, total: number) => void
): Promise<{ value: BodyInit; duplex?: boolean; dispose?: () => void }> {
  const openAsBlob = (fs as typeof fs & { openAsBlob?: (file: string) => Promise<Blob> }).openAsBlob;
  if (!onBytes && typeof openAsBlob === "function") {
    return { value: await openAsBlob.call(fs, localPath) };
  }
  const { Readable, Transform } = await import("node:stream");
  const source = fs.createReadStream(localPath);
  const dispose = (): void => {
    source.destroy();
  };
  if (!onBytes) return { value: Readable.toWeb(source) as unknown as BodyInit, duplex: true, dispose };
  let sent = 0;
  // Throttle to whole percent changes so a 200 MB upload does not emit
  // thousands of IPC messages for a bar that only has 100 positions.
  let lastPercent = -1;
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      sent += chunk.length;
      const percent = size > 0 ? Math.min(100, Math.floor((sent / size) * 100)) : 100;
      if (percent !== lastPercent) {
        lastPercent = percent;
        onBytes(sent, size);
      }
      callback(null, chunk);
    }
  });
  return { value: Readable.toWeb(source.pipe(counter)) as unknown as BodyInit, duplex: true, dispose };
}

/** Decode a PROPFIND multistatus body into entries, dropping the folder itself. */
export function parseMultistatus(xml: string, folderUrl: string): WebdavEntry[] {
  const parser = new XMLParser({
    removeNSPrefix: true,
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    trimValues: true,
    parseTagValue: false
  });
  let parsed: unknown;
  try {
    parsed = parser.parse(xml);
  } catch {
    throw new WebdavError("The WebDAV server returned a response that is not valid XML.");
  }
  const multistatus = (parsed as { multistatus?: unknown })?.multistatus;
  if (!multistatus) return [];
  const responses = toArray((multistatus as { response?: unknown }).response);
  const folderPath = decodeURIComponent(new URL(folderUrl).pathname).replace(/\/+$/, "");

  const entries: WebdavEntry[] = [];
  for (const raw of responses) {
    const node = raw as {
      href?: unknown;
      propstat?: unknown;
    };
    const href = typeof node.href === "string" ? node.href.trim() : "";
    if (!href) continue;
    let pathname: string;
    try {
      pathname = decodeURIComponent(new URL(href, folderUrl).pathname);
    } catch {
      continue;
    }
    const normalized = pathname.replace(/\/+$/, "");
    // The first response is the collection itself.
    if (normalized === folderPath) continue;
    const name = normalized.slice(normalized.lastIndexOf("/") + 1);
    if (!name) continue;

    const prop = mergePropstats(node.propstat);
    const resourceType = prop.resourcetype;
    const isCollection = Boolean(resourceType && typeof resourceType === "object" && "collection" in resourceType);
    const sizeRaw = prop.getcontentlength;
    const size = typeof sizeRaw === "string" || typeof sizeRaw === "number" ? Number(sizeRaw) : 0;
    entries.push({
      name,
      isCollection,
      size: Number.isFinite(size) ? size : 0,
      mtimeMs: parseMtime(typeof prop.getlastmodified === "string" ? prop.getlastmodified : undefined)
    });
  }
  return entries;
}

function toArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null) return [];
  return [value];
}

/** PROPFIND may split properties across several `propstat` blocks. */
function mergePropstats(value: unknown): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const entry of toArray(value)) {
    const prop = (entry as { prop?: unknown })?.prop;
    if (prop && typeof prop === "object" && !Array.isArray(prop)) {
      Object.assign(output, prop as Record<string, unknown>);
    }
  }
  return output;
}
