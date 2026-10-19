// @vitest-environment node
import { createCipheriv, createHash, randomBytes, scrypt } from "node:crypto";
import { createWriteStream } from "node:fs";
import * as fs from "node:fs/promises";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { XMLValidator } from "fast-xml-parser";

// The export path records non-fatal failures; keep the suite from writing into
// the developer's real ~/.agent-resume-panel log.
vi.mock("./appErrorLog", () => ({ recordAppError: vi.fn(async () => undefined) }));
import {
  getMachineId,
  NotesStore,
  preparePanelDatabases,
  runSqlite,
  runSqliteJson,
  type PanelSettings
} from "@agent-resume/core";
import {
  exportStoredBackup,
  importBackup,
  listStoredBackups,
  selectStoredBackupForImport,
  setThunderConversationsDirForTests,
  type ManagedBackupContext
} from "./backupService";

/** yazl ships no types; the same local shape backupService declares. */
const yazl = require("yazl") as {
  ZipFile: new () => {
    addBuffer(buffer: Buffer, metadataPath: string): void;
    end(): void;
    outputStream: NodeJS.ReadableStream;
  };
};

/**
 * End-to-end managed-backup test against an in-memory WebDAV server.
 *
 * The server implements the same six verbs the client uses, so the test covers
 * the real upload → list → download → merge path rather than a mock.
 */
interface StoredEntry {
  body: Buffer;
  mtimeMs: number;
  isCollection: boolean;
}

interface FakeDav {
  url: string;
  entries: Map<string, StoredEntry>;
  methods: string[];
  /** When false, GET ignores Range and returns 200 with the whole body. */
  supportsRange: boolean;
  close(): Promise<void>;
}

const servers: FakeDav[] = [];
const roots: string[] = [];
const USER = "user";
const SECRET = "secret";

function encodePath(value: string): string {
  return value.split("/").map((segment) => encodeURIComponent(segment)).join("/");
}

async function startDav(options: { failPropfind?: boolean } = {}): Promise<FakeDav> {
  const entries = new Map<string, StoredEntry>([
    ["/", { body: Buffer.alloc(0), mtimeMs: Date.now(), isCollection: true }]
  ]);
  const methods: string[] = [];
  const state = { supportsRange: true, failPropfind: options.failPropfind === true };

  const server = http.createServer((request, response) => {
    methods.push(request.method ?? "");
    if (request.headers.authorization !== `Basic ${Buffer.from(`${USER}:${SECRET}`).toString("base64")}`) {
      response.writeHead(401).end();
      return;
    }
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const pathname = decodeURIComponent((request.url ?? "/").split("?")[0]);
      const body = Buffer.concat(chunks);
      const target = entries.get(pathname);
      const parent = pathname.slice(0, pathname.lastIndexOf("/")) || "/";

      switch (request.method) {
        case "MKCOL": {
          if (target) {
            response.writeHead(405).end();
            return;
          }
          if (!entries.has(parent)) {
            response.writeHead(409).end();
            return;
          }
          entries.set(pathname, { body: Buffer.alloc(0), mtimeMs: Date.now(), isCollection: true });
          response.writeHead(201).end();
          return;
        }
        case "PUT": {
          if (!entries.has(parent)) {
            response.writeHead(409).end();
            return;
          }
          entries.set(pathname, { body, mtimeMs: Date.now(), isCollection: false });
          response.writeHead(201).end();
          return;
        }
        case "MOVE": {
          if (!target) {
            response.writeHead(404).end();
            return;
          }
          const destination = decodeURIComponent(new URL(String(request.headers.destination)).pathname);
          entries.set(destination, target);
          entries.delete(pathname);
          response.writeHead(201).end();
          return;
        }
        case "PROPFIND": {
          // Simulates the connection dying on the post-upload cleanup listing.
          if (state.failPropfind) {
            request.socket.destroy();
            return;
          }
          if (!target?.isCollection) {
            response.writeHead(404).end();
            return;
          }
          // Real servers reject a malformed body with 400; the fake used to
          // ignore it entirely, which hid exactly that class of bug.
          if (body.length > 0 && XMLValidator.validate(body.toString("utf8")) !== true) {
            response.writeHead(400).end();
            return;
          }
          const depth = request.headers.depth === "0" ? 0 : 1;
          const children = [...entries.entries()].filter(([entryPath]) => {
            if (entryPath === pathname) return true;
            if (!entryPath.startsWith(pathname === "/" ? "/" : `${pathname}/`)) return false;
            const rest = entryPath.slice(pathname === "/" ? 1 : pathname.length + 1);
            return depth === 1 && !rest.includes("/");
          });
          const xml = `<?xml version="1.0" encoding="utf-8"?><d:multistatus xmlns:d="DAV:">${children.map(([entryPath, entry]) => {
            const href = encodePath(entryPath) + (entry.isCollection ? "/" : "");
            const props = entry.isCollection
              ? "<d:resourcetype><d:collection/></d:resourcetype>"
              : `<d:resourcetype/><d:getcontentlength>${entry.body.length}</d:getcontentlength>`;
            return `<d:response><d:href>${href}</d:href><d:propstat><d:prop>${props}<d:getlastmodified>${new Date(entry.mtimeMs).toUTCString()}</d:getlastmodified></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`;
          }).join("")}</d:multistatus>`;
          response.writeHead(207, { "Content-Type": "application/xml; charset=utf-8" }).end(xml);
          return;
        }
        case "GET": {
          if (!target || target.isCollection) {
            response.writeHead(404).end();
            return;
          }
          const range = state.supportsRange ? /^bytes=(\d+)-(\d+)$/.exec(String(request.headers.range ?? "")) : null;
          if (range) {
            const start = Number(range[1]);
            const end = Math.min(Number(range[2]), target.body.length - 1);
            response.writeHead(206, {
              "Content-Length": String(end - start + 1),
              "Content-Range": `bytes ${start}-${end}/${target.body.length}`
            }).end(target.body.subarray(start, end + 1));
            return;
          }
          response.writeHead(200, { "Content-Length": String(target.body.length) }).end(target.body);
          return;
        }
        case "HEAD": {
          if (!target) {
            response.writeHead(404).end();
            return;
          }
          response.writeHead(200, { "Content-Length": String(target.body.length) }).end();
          return;
        }
        case "DELETE": {
          if (!target) {
            response.writeHead(404).end();
            return;
          }
          entries.delete(pathname);
          response.writeHead(204).end();
          return;
        }
        default:
          response.writeHead(405).end();
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const fake: FakeDav = {
    url: `http://127.0.0.1:${port}`,
    entries,
    methods,
    get supportsRange() { return state.supportsRange; },
    set supportsRange(value: boolean) { state.supportsRange = value; },
    close: () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  };
  servers.push(fake);
  return fake;
}

function context(settings: PanelSettings, dav: FakeDav): ManagedBackupContext {
  return {
    settings,
    webdav: { url: dav.url, username: USER, password: SECRET, folder: "Agent Resume/Backups" }
  };
}

/**
 * A panel home with isolated Agent homes. Without this the collector would read
 * the developer's real `~/.codex` and friends, which is both slow and unstable.
 */
async function makeHome(): Promise<PanelSettings> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-resume-webdav-backup-"));
  roots.push(root);
  const agents = path.join(root, "agent-homes");
  const home = (name: string) => path.join(agents, name);
  return {
    panelHome: root,
    agentHomes: {
      codexHome: home("codex"),
      claudeHome: home("claude"),
      antigravityHome: home("agy"),
      grokHome: home("grok"),
      opencodeHome: home("opencode"),
      piHome: home("pi"),
      primeHome: home("prime"),
      ompHome: home("omp"),
      cursorHome: home("cursor")
    }
  } as PanelSettings;
}

const BACKUP_DIR = "/Agent Resume/Backups";

beforeEach(() => {
  const root = path.join(os.tmpdir(), `agent-resume-thunder-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  roots.push(root);
  setThunderConversationsDirForTests(root);
});

afterEach(async () => {
  setThunderConversationsDirForTests(undefined);
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

/** Build a real managed archive so retention can be exercised without 11 exports. */
async function seedArchive(name: string, backupId: string, createdAtMs: number, machineId: string): Promise<Buffer> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-resume-seed-"));
  roots.push(dir);
  const file = path.join(dir, "seed.zip");
  const manifest = {
    formatVersion: 2,
    backupId,
    createdAtMs,
    sourceMachineId: machineId,
    appVersion: "test",
    credentialsEncrypted: false,
    files: [{ path: "payload/catalog.db", size: 3, mtimeMs: createdAtMs, sha256: createHash("sha256").update("abc").digest("hex") }]
  };
  const zip = new yazl.ZipFile();
  zip.addBuffer(Buffer.from(`${JSON.stringify(manifest)}\n`), "manifest.json");
  zip.addBuffer(Buffer.from("abc"), "payload/catalog.db");
  const written = new Promise<void>((resolve, reject) => {
    zip.outputStream.on("error", reject).pipe(createWriteStream(file)).on("close", () => resolve());
  });
  zip.end();
  await written;
  return fs.readFile(file);
}

/** Managed exports always carry the stored item; fail loudly if one does not. */
function storedItem(result: Awaited<ReturnType<typeof exportStoredBackup>>) {
  if (!result.storedItem) throw new Error("expected a stored item");
  return result.storedItem;
}

describe("WebDAV managed backups", () => {
  it("uploads, lists, and restores a plaintext ZIP round trip", async () => {
    const dav = await startDav();
    const source = await makeHome();
    const target = await makeHome();
    const sourcePaths = await preparePanelDatabases(source);
    const targetPaths = await preparePanelDatabases(target);

    // Content the archive must carry: a note, its hierarchy, its archive mark,
    // a task template with an image, and a Thunder conversation.
    const sourceNotes = new NotesStore(sourcePaths.catalogDb, source.panelHome!);
    await sourceNotes.initialize();
    // Only a project note or a task can own linked children.
    const parentNote = await sourceNotes.createProjectNote("/project-x", "# Parent\n");
    const childNote = await sourceNotes.createLibraryNote("# Child\n");
    await sourceNotes.setNoteParent(childNote.noteId, parentNote.noteId);
    // Archive marks and hierarchy live only in SQLite, so a restore must carry them.
    await runSqlite(sourcePaths.catalogDb, `INSERT INTO note_archive (note_id, archived_at_ms) VALUES ('${parentNote.noteId}', 300);`);
    await runSqlite(sourcePaths.desktopDb, `
      INSERT INTO task_templates (template_id, title, created_at_ms, updated_at_ms) VALUES ('template-1', 'Release', 100, 200);
      INSERT INTO selection_actions (action_id, name, prompt, sort_order, enabled, created_at_ms, updated_at_ms) VALUES ('action-1', 'Explain', 'Explain this', 0, 1, 100, 200);
      INSERT INTO thunder_schedules (id, name, prompt, trigger_type, trigger_value, enabled, created_at_ms, updated_at_ms) VALUES ('schedule-1', 'Daily', 'Summarize', 'interval', '86400000', 1, 100, 200);
      INSERT INTO session_embeddings (provider, agent_session_id, title, summary_preview, embedding_json, content_hash, embedding_key, updated_at_ms) VALUES ('codex', 'session-1', 'Indexed', 'preview', '[0.1]', 'hash', 'model', 500);
    `);
    const templates = path.join(source.panelHome!, "templates");
    await fs.mkdir(templates, { recursive: true });
    await fs.writeFile(path.join(templates, "template-1.png"), "png-bytes");
    const workspaces = path.join(source.panelHome!, ".desktop", "workspaces", "task-1");
    await fs.mkdir(path.join(workspaces, ".worktrees", "checkout"), { recursive: true });
    await fs.writeFile(path.join(workspaces, "AGENTS.md"), "address table");
    await fs.writeFile(path.join(workspaces, ".worktrees", "checkout", "big.bin"), "worktree");

    const progress: Array<{ phase: string; percent: number }> = [];
    const exported = await exportStoredBackup(context(source, dav), "webdav", "test", {
      includeNativeConversations: true,
      onProgress: (event) => progress.push({ phase: event.phase, percent: event.percent })
    });
    const item = storedItem(exported);
    expect(item.encrypted).toBe(false);
    expect(item.metadataComplete).toBe(true);
    expect(exported.file).toContain("/Agent%20Resume/Backups/agent-resume-");
    // Upload reports real byte progress, so the bar moves before the transfer ends.
    const uploading = progress.filter((event) => event.phase === "uploading").map((event) => event.percent);
    expect(uploading.length).toBeGreaterThan(0);
    expect(uploading[uploading.length - 1]).toBe(99);
    expect(uploading).toEqual([...uploading].sort((left, right) => left - right));
    expect(progress[progress.length - 1]).toEqual({ phase: "complete", percent: 100 });
    // The upload is a MOVE from `.partial`, so no half-written file is listed.
    expect(dav.methods).toContain("MKCOL");
    expect(dav.methods).toContain("MOVE");
    expect([...dav.entries.keys()].some((key) => key.endsWith(".partial"))).toBe(false);

    const listed = await listStoredBackups(context(source, dav), "webdav");
    expect(listed).toHaveLength(1);
    expect(listed[0].backupId).toBe(item.backupId);
    expect(listed[0].sourceMachineId).toBe(await getMachineId());
    expect(listed[0].fileName).toBe(item.fileName);

    const preview = await selectStoredBackupForImport(context(source, dav), "webdav", listed[0].backupId);
    await importBackup(target, preview.importToken, "test", {
      restoreNativeConversations: true,
      recoveryDir: path.join(target.panelHome!, "recovery")
    });

    const links = await runSqliteJson<{ child_note_id: string; parent_note_id: string }>(targetPaths.catalogDb, "SELECT child_note_id, parent_note_id FROM note_links;");
    const archived = await runSqliteJson<{ note_id: string; archived_at_ms: number }>(targetPaths.catalogDb, "SELECT note_id, archived_at_ms FROM note_archive;");
    const templatesRows = await runSqliteJson<{ title: string }>(targetPaths.desktopDb, "SELECT title FROM task_templates;");
    const actions = await runSqliteJson<{ name: string }>(targetPaths.desktopDb, "SELECT name FROM selection_actions;");
    const schedules = await runSqliteJson<{ name: string }>(targetPaths.desktopDb, "SELECT name FROM thunder_schedules;");

    expect(links).toEqual([{ child_note_id: childNote.noteId, parent_note_id: parentNote.noteId }]);
    expect(archived).toEqual([{ note_id: parentNote.noteId, archived_at_ms: 300 }]);
    expect(templatesRows).toEqual([{ title: "Release" }]);
    expect(actions).toEqual([{ name: "Explain" }]);
    expect(schedules).toEqual([{ name: "Daily" }]);
    await expect(fs.readFile(path.join(target.panelHome!, "templates", "template-1.png"), "utf8")).resolves.toBe("png-bytes");
    await expect(fs.readFile(path.join(target.panelHome!, ".desktop", "workspaces", "task-1", "AGENTS.md"), "utf8")).resolves.toBe("address table");
    // Worktrees are machine-local runtime state and never travel.
    await expect(fs.access(path.join(target.panelHome!, ".desktop", "workspaces", "task-1", ".worktrees", "checkout", "big.bin"))).rejects.toMatchObject({ code: "ENOENT" });
  }, 60_000);

  it("keeps a saved backup when the post-upload cleanup fails", async () => {
    const dav = await startDav({ failPropfind: true });
    const source = await makeHome();
    await preparePanelDatabases(source);

    // Pruning runs after the ZIP is published; its listing resets here. The
    // export already succeeded, so the failure must not surface as an error.
    const exported = await exportStoredBackup(context(source, dav), "webdav", "test", {
      includeNativeConversations: false
    });

    expect(exported.storedItem?.fileName).toMatch(/^agent-resume-.*\.zip$/);
    const saved = [...dav.entries.keys()].filter((key) => key.endsWith(".zip"));
    expect(saved).toHaveLength(1);
  }, 60_000);

  it("never writes API keys into the archive and keeps local ones on restore", async () => {
    const dav = await startDav();
    const source = await makeHome();
    const target = await makeHome();
    await preparePanelDatabases(source);
    await preparePanelDatabases(target);
    const apiKey = "sk-live-should-not-travel";
    await fs.writeFile(path.join(source.panelHome!, "settings.json"), `${JSON.stringify({ providers: [{ id: "p", apiKey }] }, null, 2)}\n`);
    await fs.writeFile(path.join(target.panelHome!, "settings.json"), `${JSON.stringify({ providers: [{ id: "p", apiKey: "sk-local" }] }, null, 2)}\n`);

    const exported = await exportStoredBackup(context(source, dav), "webdav", "test", { includeNativeConversations: false });
    const fileName = path.basename(decodeURIComponent(exported.file ?? ""));
    const archive = dav.entries.get(`${BACKUP_DIR}/${fileName}`)?.body;
    expect(archive).toBeDefined();
    expect(archive!.includes(Buffer.from(apiKey))).toBe(false);

    const preview = await selectStoredBackupForImport(context(source, dav), "webdav", storedItem(exported).backupId);
    await importBackup(target, preview.importToken, "test", {
      restoreNativeConversations: false,
      recoveryDir: path.join(target.panelHome!, "recovery")
    });

    const settings = JSON.parse(await fs.readFile(path.join(target.panelHome!, "settings.json"), "utf8")) as { providers: Array<{ apiKey: string }> };
    expect(settings.providers[0].apiKey).toBe("sk-local");
  }, 60_000);

  it("keeps only the newest 10 backups this machine created", async () => {
    const dav = await startDav();
    const home = await makeHome();
    await preparePanelDatabases(home);
    const machineId = await getMachineId();
    dav.entries.set(BACKUP_DIR, { body: Buffer.alloc(0), mtimeMs: Date.now(), isCollection: true });
    for (let index = 0; index < 10; index += 1) {
      const id = String(index).padStart(32, "0");
      const createdAtMs = Date.UTC(2025, 0, 1 + index);
      const name = `agent-resume-${new Date(createdAtMs).toISOString().replace(/[-:.]/g, "")}-${machineId}-${id}.zip`;
      dav.entries.set(`${BACKUP_DIR}/${name}`, { body: await seedArchive(name, id, createdAtMs, machineId), mtimeMs: createdAtMs, isCollection: false });
    }

    await exportStoredBackup(context(home, dav), "webdav", "test", { includeNativeConversations: false });

    const archives = [...dav.entries.keys()].filter((key) => key.startsWith(`${BACKUP_DIR}/`) && key.endsWith(".zip"));
    expect(archives).toHaveLength(10);
    // The oldest seeded backup is the one that goes.
    expect(archives.some((key) => key.includes(`-${"0".repeat(32)}.zip`))).toBe(false);
  }, 60_000);

  it("falls back to filename metadata when the server ignores Range", async () => {
    const dav = await startDav();
    dav.supportsRange = false;
    const home = await makeHome();
    await preparePanelDatabases(home);

    const exported = await exportStoredBackup(context(home, dav), "webdav", "test", { includeNativeConversations: false });
    const listed = await listStoredBackups(context(home, dav), "webdav");

    expect(listed).toHaveLength(1);
    const item = storedItem(exported);
    expect(listed[0]).toMatchObject({
      backupId: item.backupId,
      createdAtMs: item.createdAtMs,
      metadataComplete: false,
      nativeConversationFileCount: 0
    });
  }, 60_000);

  it("refuses to export to WebDAV before the server is configured", async () => {
    const home = await makeHome();
    await expect(exportStoredBackup({ settings: home }, "webdav", "test", {})).rejects.toThrow(/WebDAV server URL/);
  });

  it("sweeps stale partial uploads and ignores fresh ones", async () => {
    const dav = await startDav();
    const home = await makeHome();
    await preparePanelDatabases(home);
    dav.entries.set(BACKUP_DIR, { body: Buffer.alloc(0), mtimeMs: Date.now(), isCollection: true });
    const stale = Date.now() - 48 * 60 * 60 * 1000;
    dav.entries.set(`${BACKUP_DIR}/agent-resume-old.zip.partial`, { body: Buffer.from("half"), mtimeMs: stale, isCollection: false });
    dav.entries.set(`${BACKUP_DIR}/agent-resume-new.zip.partial`, { body: Buffer.from("half"), mtimeMs: Date.now(), isCollection: false });

    const listed = await listStoredBackups(context(home, dav), "webdav");

    expect(listed).toEqual([]);
    expect(dav.entries.has(`${BACKUP_DIR}/agent-resume-old.zip.partial`)).toBe(false);
    expect(dav.entries.has(`${BACKUP_DIR}/agent-resume-new.zip.partial`)).toBe(true);
  }, 60_000);

  it("restores an older encrypted .arbak backup with its password", async () => {
    const dav = await startDav();
    const source = await makeHome();
    const target = await makeHome();
    await preparePanelDatabases(source);
    await preparePanelDatabases(target);

    // Build a current ZIP, then wrap it in the legacy ARBAK envelope.
    const exported = await exportStoredBackup(context(source, dav), "webdav", "test", { includeNativeConversations: false });
    const currentName = path.basename(decodeURIComponent(exported.file ?? ""));
    const zip = dav.entries.get(`${BACKUP_DIR}/${currentName}`)!.body;
    const legacyItem = storedItem(exported);
    const legacyId = "f".repeat(32);
    const password = "legacy-pass";
    const salt = randomBytes(16);
    const iv = randomBytes(12);
    const key = await new Promise<Buffer>((resolve, reject) => {
      scrypt(password, salt, 32, { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, value) => error ? reject(error) : resolve(value as Buffer));
    });
    const header = Buffer.from(JSON.stringify({
      formatVersion: 1,
      backupId: legacyId,
      createdAtMs: legacyItem.createdAtMs,
      sourceMachineId: await getMachineId(),
      appVersion: "test",
      plaintextBytes: zip.length,
      fileCount: exported.fileCount ?? 0,
      nativeConversationFileCount: 0,
      nativeConversationBytes: 0,
      providers: [],
      salt: salt.toString("base64"),
      iv: iv.toString("base64"),
      kdf: { name: "scrypt", N: 16_384, r: 8, p: 1 }
    }), "utf8");
    const prefix = Buffer.concat([Buffer.from("ARBAK001", "ascii"), (() => {
      const size = Buffer.alloc(4);
      size.writeUInt32BE(header.length);
      return size;
    })(), header]);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(header);
    const ciphertext = Buffer.concat([cipher.update(zip), cipher.final()]);
    const legacyName = `agent-resume-${new Date(legacyItem.createdAtMs).toISOString().replace(/[-:.]/g, "")}-${await getMachineId()}-${legacyId}.arbak`;
    dav.entries.set(`${BACKUP_DIR}/${legacyName}`, {
      body: Buffer.concat([prefix, ciphertext, cipher.getAuthTag()]),
      mtimeMs: Date.now(),
      isCollection: false
    });
    dav.entries.delete(`${BACKUP_DIR}/${currentName}`);

    const listed = await listStoredBackups(context(source, dav), "webdav");
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ backupId: legacyId, encrypted: true, metadataComplete: true });

    await expect(selectStoredBackupForImport(context(source, dav), "webdav", legacyId)).rejects.toThrow(/password/i);
    const preview = await selectStoredBackupForImport(context(source, dav), "webdav", legacyId, password);
    await importBackup(target, preview.importToken, "test", {
      restoreNativeConversations: false,
      password,
      recoveryDir: path.join(target.panelHome!, "recovery")
    });
    await expect(fs.access(path.join(target.panelHome!, "catalog.db"))).resolves.toBeUndefined();
  }, 60_000);

  it("restores a Thunder conversation only when the backup is newer", async () => {
    const dav = await startDav();
    const source = await makeHome();
    const target = await makeHome();
    await preparePanelDatabases(source);
    await preparePanelDatabases(target);
    const sourceThunder = path.join(os.tmpdir(), `agent-resume-thunder-src-${Date.now()}`);
    const targetThunder = path.join(os.tmpdir(), `agent-resume-thunder-dst-${Date.now()}`);
    roots.push(sourceThunder, targetThunder);

    // Thunder keeps `<id>/conversation.json` directly under the conversations root.
    const writeThunder = async (root: string, id: string, updatedAtMs: number, title: string) => {
      await fs.mkdir(path.join(root, id), { recursive: true });
      await fs.writeFile(path.join(root, id, "conversation.json"), JSON.stringify({ id, title, updated_at_ms: updatedAtMs }));
      // index.json is one map for the whole store, so later writes extend it.
      const existing = await fs.readFile(path.join(root, "index.json"), "utf8").then((raw) => JSON.parse(raw) as Record<string, unknown>).catch(() => ({}));
      await fs.writeFile(path.join(root, "index.json"), JSON.stringify({ ...existing, [id]: { id, title, updated_at_ms: updatedAtMs } }));
    };
    await writeThunder(sourceThunder, "s1", 200, "From backup");
    await writeThunder(sourceThunder, "s2", 100, "Backup only");
    // A trace file must never be collected.
    await fs.mkdir(path.join(sourceThunder, "s1", "traces"), { recursive: true });
    await fs.writeFile(path.join(sourceThunder, "s1", "traces", "trace.json"), "{}");

    setThunderConversationsDirForTests(sourceThunder);
    const exported = await exportStoredBackup(context(source, dav), "webdav", "test", { includeNativeConversations: true });
    expect(storedItem(exported).providers.find((provider) => provider.provider === "thunder")?.fileCount).toBe(3);

    // The target has a newer copy of s1 and a local-only s3.
    await writeThunder(targetThunder, "s1", 900, "Local newer");
    await writeThunder(targetThunder, "s3", 50, "Local only");
    setThunderConversationsDirForTests(targetThunder);

    const preview = await selectStoredBackupForImport(context(source, dav), "webdav", storedItem(exported).backupId);
    await importBackup(target, preview.importToken, "test", {
      restoreNativeConversations: true,
      recoveryDir: path.join(target.panelHome!, "recovery")
    });

    const conversation = JSON.parse(await fs.readFile(path.join(targetThunder, "s1", "conversation.json"), "utf8")) as { title: string };
    const index = JSON.parse(await fs.readFile(path.join(targetThunder, "index.json"), "utf8")) as Record<string, { title: string }>;
    expect(conversation.title).toBe("Local newer");
    expect(index.s1.title).toBe("Local newer");
    expect(index.s2.title).toBe("Backup only");
    expect(index.s3.title).toBe("Local only");
    await expect(fs.readFile(path.join(targetThunder, "s2", "conversation.json"), "utf8")).resolves.toContain("Backup only");
    await expect(fs.access(path.join(targetThunder, "s1", "traces", "trace.json"))).rejects.toMatchObject({ code: "ENOENT" });
  }, 60_000);
});
