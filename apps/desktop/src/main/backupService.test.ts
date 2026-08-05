import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  preparePanelDatabases,
  NotesStore,
  runSqlite,
  runSqliteJson,
  assignWorkbenchSessionToFolder,
  createWorkbenchSessionFolder,
  listWorkbenchSessionFolderAssignments,
  listWorkbenchSessionFolders,
  type PanelSettings
} from "@agent-resume/core";
import { exportBackup, importBackup, selectBackupForImport } from "./backupService";

const roots: string[] = [];

async function makeSettings(): Promise<PanelSettings> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-resume-backup-test-"));
  roots.push(root);
  return { panelHome: root } as PanelSettings;
}

describe("backupService", () => {
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
  });

  it("merges newer catalog rows while removing retired execution notes from an older backup", async () => {
    const sourceSettings = await makeSettings();
    const targetSettings = await makeSettings();
    const sourceHome = sourceSettings.panelHome!;
    const targetHome = targetSettings.panelHome!;
    const sourcePaths = await preparePanelDatabases(sourceSettings);
    const targetPaths = await preparePanelDatabases(targetSettings);

    await runSqlite(sourcePaths.catalogDb, `INSERT INTO sessions (provider, agent_session_id, title, project_path, updated_at_ms) VALUES ('codex', 'session-1', 'Imported', '/source', 200); INSERT INTO sync_state (provider, last_sync_at_ms) VALUES ('codex', 200);`);
    const sourceNotes = new NotesStore(sourcePaths.catalogDb, sourceHome);
    await sourceNotes.initialize();
    const executionNote = await sourceNotes.createSessionNote({ provider: "codex", id: "session-1", projectPath: "/source" }, "# Session execution record\n\nLegacy managed note");
    await runSqlite(sourcePaths.desktopDb, `
      CREATE TABLE session_execution_notes (
        provider TEXT NOT NULL,
        agent_session_id TEXT NOT NULL,
        note_id TEXT NOT NULL UNIQUE,
        desktop_tracking INTEGER NOT NULL DEFAULT 0,
        last_observed_updated_at_ms INTEGER NOT NULL DEFAULT 0,
        last_activity_log_at_ms INTEGER NOT NULL DEFAULT 0,
        last_state TEXT,
        last_state_at_ms INTEGER NOT NULL DEFAULT 0,
        created_at_ms INTEGER NOT NULL,
        updated_at_ms INTEGER NOT NULL,
        PRIMARY KEY (provider, agent_session_id)
      );
      INSERT INTO session_embeddings (provider, agent_session_id, title, summary_preview, embedding_json, content_hash, embedding_key, updated_at_ms) VALUES ('codex', 'session-1', 'Imported', 'summary', '[0.1,0.2]', 'hash-new', 'model-a', 200);
      INSERT INTO note_chunks (chunk_id, note_id, rel_md_path, scope, title, heading, chunk_index, content, content_hash, embedding_json, updated_at_ms) VALUES ('execution-chunk', '${executionNote.noteId}', '${executionNote.relMdPath}', 'session', 'Session execution record', NULL, 0, 'Legacy managed note', 'chunk-hash', '[0.1,0.2]', 200);
      INSERT INTO note_vector_index (note_id, rel_md_path, scope, title, source_mtime_ms, content_hash, embedding_key, indexed_at_ms) VALUES ('${executionNote.noteId}', '${executionNote.relMdPath}', 'session', 'Session execution record', 200, 'note-hash', 'model-a', 200);
      INSERT INTO session_execution_notes (provider, agent_session_id, note_id, desktop_tracking, last_observed_updated_at_ms, last_activity_log_at_ms, last_state, last_state_at_ms, created_at_ms, updated_at_ms) VALUES ('codex', 'session-1', '${executionNote.noteId}', 1, 200, 200, 'active', 200, 200, 200);
    `);
    await runSqlite(targetPaths.catalogDb, `INSERT INTO sessions (provider, agent_session_id, title, project_path, updated_at_ms) VALUES ('codex', 'session-1', 'Local', '/target', 100); INSERT INTO sync_state (provider, last_sync_at_ms) VALUES ('codex', 999);`);

    const archive = path.join(sourceHome, "backup.zip");
    await exportBackup(sourceSettings, archive, "test", { includeCredentials: false, includeNativeConversations: false });
    const preview = await selectBackupForImport(archive);
    await importBackup(targetSettings, preview.importToken, "test", {
      includeCredentials: false,
      restoreNativeConversations: false,
      recoveryDir: path.join(targetHome, "recovery")
    });

    const sessions = await runSqliteJson<{ title: string; updated_at_ms: number }>(targetPaths.catalogDb, "SELECT title, updated_at_ms FROM sessions WHERE provider = 'codex' AND agent_session_id = 'session-1';");
    const vectors = await runSqliteJson<{ embedding_key: string; content_hash: string }>(targetPaths.desktopDb, "SELECT embedding_key, content_hash FROM session_embeddings WHERE provider = 'codex' AND agent_session_id = 'session-1';");
    const sync = await runSqliteJson<{ last_sync_at_ms: number }>(targetPaths.catalogDb, "SELECT last_sync_at_ms FROM sync_state WHERE provider = 'codex';");
    const legacyTables = await runSqliteJson<{ name: string }>(targetPaths.desktopDb, "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'session_execution_notes';");
    const executionNotes = await runSqliteJson<{ note_id: string }>(targetPaths.catalogDb, `SELECT note_id FROM notes WHERE note_id = '${executionNote.noteId}';`);
    const executionChunks = await runSqliteJson<{ note_id: string }>(targetPaths.desktopDb, `SELECT note_id FROM note_chunks WHERE note_id = '${executionNote.noteId}';`);
    const executionVectors = await runSqliteJson<{ note_id: string }>(targetPaths.desktopDb, `SELECT note_id FROM note_vector_index WHERE note_id = '${executionNote.noteId}';`);

    expect(sessions).toEqual([{ title: "Imported", updated_at_ms: 200 }]);
    expect(vectors).toEqual([{ embedding_key: "model-a", content_hash: "hash-new" }]);
    expect(sync).toEqual([{ last_sync_at_ms: 999 }]);
    expect(legacyTables).toEqual([]);
    expect(executionNotes).toEqual([]);
    expect(executionChunks).toEqual([]);
    expect(executionVectors).toEqual([]);
    await expect(fs.access(path.join(targetHome, executionNote.relMdPath))).rejects.toMatchObject({ code: "ENOENT" });
  }, 30_000);

  it("backs up and restores Workbench session folder trees", async () => {
    const sourceSettings = await makeSettings();
    const targetSettings = await makeSettings();
    const sourcePaths = await preparePanelDatabases(sourceSettings);
    const targetPaths = await preparePanelDatabases(targetSettings);
    const campaign = await createWorkbenchSessionFolder(sourcePaths.desktopDb, "project-1", null, "Campaign");
    const phase = await createWorkbenchSessionFolder(sourcePaths.desktopDb, "project-1", campaign.folderId, "Phase 1");
    await assignWorkbenchSessionToFolder(sourcePaths.desktopDb, "project-1", "codex", "session-1", phase.folderId);

    const archive = path.join(sourceSettings.panelHome!, "folder-backup.zip");
    await exportBackup(sourceSettings, archive, "test", { includeCredentials: false, includeNativeConversations: false });
    const preview = await selectBackupForImport(archive);
    await importBackup(targetSettings, preview.importToken, "test", {
      includeCredentials: false,
      restoreNativeConversations: false,
      recoveryDir: path.join(targetSettings.panelHome!, "recovery")
    });

    const folders = await listWorkbenchSessionFolders(targetPaths.desktopDb, "project-1");
    expect(folders.map((folder) => [folder.name, folder.parentId])).toEqual([
      ["Campaign", null],
      ["Phase 1", campaign.folderId]
    ]);
    await expect(listWorkbenchSessionFolderAssignments(targetPaths.desktopDb, "project-1")).resolves.toMatchObject([
      { provider: "codex", agentSessionId: "session-1", folderId: phase.folderId }
    ]);
  }, 30_000);

  it("removes a retired execution note during database preparation", async () => {
    const settings = await makeSettings();
    const paths = await preparePanelDatabases(settings);
    const notes = new NotesStore(paths.catalogDb, settings.panelHome);
    await notes.initialize();
    const executionNote = await notes.createSessionNote({ provider: "codex", id: "session-2", projectPath: "/legacy" }, "# Session execution record");

    await runSqlite(paths.desktopDb, `
      CREATE TABLE session_execution_notes (
        provider TEXT NOT NULL,
        agent_session_id TEXT NOT NULL,
        note_id TEXT NOT NULL UNIQUE,
        desktop_tracking INTEGER NOT NULL DEFAULT 0,
        last_observed_updated_at_ms INTEGER NOT NULL DEFAULT 0,
        last_activity_log_at_ms INTEGER NOT NULL DEFAULT 0,
        last_state TEXT,
        last_state_at_ms INTEGER NOT NULL DEFAULT 0,
        created_at_ms INTEGER NOT NULL,
        updated_at_ms INTEGER NOT NULL,
        PRIMARY KEY (provider, agent_session_id)
      );
      INSERT INTO note_chunks (chunk_id, note_id, rel_md_path, scope, chunk_index, content, content_hash, embedding_json, updated_at_ms) VALUES ('startup-chunk', '${executionNote.noteId}', '${executionNote.relMdPath}', 'session', 0, 'legacy', 'hash', '[0.1]', 1);
      INSERT INTO note_vector_index (note_id, rel_md_path, scope, source_mtime_ms, content_hash, embedding_key, indexed_at_ms) VALUES ('${executionNote.noteId}', '${executionNote.relMdPath}', 'session', 1, 'hash', 'model', 1);
      INSERT INTO session_execution_notes (provider, agent_session_id, note_id, desktop_tracking, last_observed_updated_at_ms, last_activity_log_at_ms, last_state, last_state_at_ms, created_at_ms, updated_at_ms) VALUES ('codex', 'session-2', '${executionNote.noteId}', 1, 1, 1, 'active', 1, 1, 1);
    `);

    await preparePanelDatabases(settings);

    const legacyTables = await runSqliteJson<{ name: string }>(paths.desktopDb, "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'session_execution_notes';");
    const noteRows = await runSqliteJson<{ note_id: string }>(paths.catalogDb, `SELECT note_id FROM notes WHERE note_id = '${executionNote.noteId}';`);
    const chunkRows = await runSqliteJson<{ note_id: string }>(paths.desktopDb, `SELECT note_id FROM note_chunks WHERE note_id = '${executionNote.noteId}';`);
    const vectorRows = await runSqliteJson<{ note_id: string }>(paths.desktopDb, `SELECT note_id FROM note_vector_index WHERE note_id = '${executionNote.noteId}';`);

    expect(legacyTables).toEqual([]);
    expect(noteRows).toEqual([]);
    expect(chunkRows).toEqual([]);
    expect(vectorRows).toEqual([]);
  }, 30_000);

  it("backs up supported native conversations and restores only missing or older Agent files", async () => {
    const sourceSettings = await makeSettings();
    const targetSettings = await makeSettings();
    const sourceHome = sourceSettings.panelHome!;
    const targetHome = targetSettings.panelHome!;
    const sourceAgents = path.join(sourceHome, "agent-homes");
    const targetAgents = path.join(targetHome, "agent-homes");
    sourceSettings.agentHomes = {
      codexHome: path.join(sourceAgents, "codex"), claudeHome: path.join(sourceAgents, "claude"),
      antigravityHome: path.join(sourceAgents, "agy"), grokHome: path.join(sourceAgents, "grok"),
      opencodeHome: path.join(sourceAgents, "opencode"), piHome: path.join(sourceAgents, "pi"),
      cursorHome: path.join(sourceAgents, "cursor")
    };
    targetSettings.agentHomes = {
      codexHome: path.join(targetAgents, "codex"), claudeHome: path.join(targetAgents, "claude"),
      antigravityHome: path.join(targetAgents, "agy"), grokHome: path.join(targetAgents, "grok"),
      opencodeHome: path.join(targetAgents, "opencode"), piHome: path.join(targetAgents, "pi"),
      cursorHome: path.join(targetAgents, "cursor")
    };
    await preparePanelDatabases(sourceSettings);
    await preparePanelDatabases(targetSettings);

    const write = async (root: string, relative: string, value: string, mtimeMs: number) => {
      const file = path.join(root, ...relative.split("/"));
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, value, "utf8");
      await fs.utimes(file, new Date(mtimeMs), new Date(mtimeMs));
      return file;
    };
    await write(sourceAgents, "codex/sessions/missing.jsonl", "{\"id\":\"missing\"}\n", 1_000);
    await write(sourceAgents, "codex/sessions/conflict.jsonl", "{\"id\":\"source\"}\n", 1_000);
    await write(sourceAgents, "codex/session_index.jsonl", "{\"id\":\"index\",\"updatedAt\":200}\n", 2_000);
    const localConflict = await write(targetAgents, "codex/sessions/conflict.jsonl", "{\"id\":\"local\"}\n", 3_000);
    await write(targetAgents, "codex/session_index.jsonl", "{\"id\":\"index\",\"updatedAt\":100}\n", 1_000);

    const archive = path.join(sourceHome, "native.zip");
    await exportBackup(sourceSettings, archive, "test", { includeCredentials: false, includeNativeConversations: true });
    const preview = await selectBackupForImport(archive);
    expect(preview.nativeConversationFileCount).toBe(3);
    expect(preview.providers.find((provider) => provider.provider === "codex")?.fileCount).toBe(3);
    await importBackup(targetSettings, preview.importToken, "test", {
      includeCredentials: false,
      restoreNativeConversations: true,
      recoveryDir: path.join(targetHome, "recovery")
    });

    await expect(fs.readFile(path.join(targetAgents, "codex", "sessions", "missing.jsonl"), "utf8")).resolves.toBe("{\"id\":\"missing\"}\n");
    await expect(fs.readFile(localConflict, "utf8")).resolves.toBe("{\"id\":\"local\"}\n");
    await expect(fs.readFile(path.join(targetAgents, "codex", "session_index.jsonl"), "utf8")).resolves.toContain("\"updatedAt\":200");
  }, 30_000);

  it("restores a compact OpenCode artifact without archived sessions, event history, or secrets", async () => {
    const sourceSettings = await makeSettings();
    const targetSettings = await makeSettings();
    const sourceHome = sourceSettings.panelHome!;
    const targetHome = targetSettings.panelHome!;
    const sourceAgents = path.join(sourceHome, "agent-homes");
    const targetAgents = path.join(targetHome, "agent-homes");
    sourceSettings.agentHomes = {
      codexHome: path.join(sourceAgents, "codex"), claudeHome: path.join(sourceAgents, "claude"), antigravityHome: path.join(sourceAgents, "agy"),
      grokHome: path.join(sourceAgents, "grok"), opencodeHome: path.join(sourceAgents, "opencode"), piHome: path.join(sourceAgents, "pi"), cursorHome: path.join(sourceAgents, "cursor")
    };
    targetSettings.agentHomes = {
      codexHome: path.join(targetAgents, "codex"), claudeHome: path.join(targetAgents, "claude"), antigravityHome: path.join(targetAgents, "agy"),
      grokHome: path.join(targetAgents, "grok"), opencodeHome: path.join(targetAgents, "opencode"), piHome: path.join(targetAgents, "pi"), cursorHome: path.join(targetAgents, "cursor")
    };
    await preparePanelDatabases(sourceSettings);
    await preparePanelDatabases(targetSettings);
    const sourceDb = path.join(sourceAgents, "opencode", "opencode.db");
    await fs.mkdir(path.dirname(sourceDb), { recursive: true });
    await runSqlite(sourceDb, `
      CREATE TABLE project (id TEXT PRIMARY KEY, worktree TEXT NOT NULL, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL);
      CREATE TABLE session (id TEXT PRIMARY KEY, project_id TEXT, title TEXT NOT NULL, share_url TEXT, permission TEXT, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, time_archived INTEGER);
      CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL);
      CREATE TABLE event_sequence (aggregate_id TEXT PRIMARY KEY, seq INTEGER NOT NULL);
      CREATE TABLE event (id TEXT PRIMARY KEY, aggregate_id TEXT NOT NULL, seq INTEGER NOT NULL, type TEXT NOT NULL, data TEXT NOT NULL);
      CREATE TABLE account (id TEXT PRIMARY KEY, access_token TEXT NOT NULL);
      CREATE TABLE credential (id TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE permission (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, action TEXT NOT NULL, resource TEXT NOT NULL, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL);
      CREATE TABLE session_share (session_id TEXT PRIMARY KEY, secret TEXT NOT NULL);
      INSERT INTO project VALUES ('p1', '/project', 1, 2);
      INSERT INTO session VALUES ('active', 'p1', 'Current', 'https://share', '{"allow":true}', 1, 200, NULL);
      INSERT INTO session VALUES ('archived', 'p1', 'Old', 'https://share-old', '{"allow":true}', 1, 100, 99);
      INSERT INTO message VALUES ('m-active', 'active', 1, 2, 'current message');
      INSERT INTO message VALUES ('m-archived', 'archived', 1, 2, 'old message');
      INSERT INTO event_sequence VALUES ('active', 9);
      INSERT INTO event VALUES ('event-1', 'active', 9, 'snapshot', 'historical update');
      INSERT INTO account VALUES ('account-1', 'access-token');
      INSERT INTO credential VALUES ('credential-1', 'credential-value');
      INSERT INTO permission VALUES ('permission-1', 'p1', 'read', '*', 1, 2);
      INSERT INTO session_share VALUES ('active', 'share-secret');
    `);

    const archive = path.join(sourceHome, "compact-opencode.zip");
    const exportProgress: Array<{ operation: string; phase: string; percent: number }> = [];
    await exportBackup(sourceSettings, archive, "test", { includeCredentials: false, includeNativeConversations: true, onProgress: (event) => exportProgress.push(event) });
    expect(exportProgress[0]).toMatchObject({ operation: "export", phase: "preparing" });
    expect(exportProgress.at(-1)).toMatchObject({ operation: "export", phase: "complete", percent: 100 });
    const preview = await selectBackupForImport(archive);
    expect(preview.providers.find((provider) => provider.provider === "opencode")?.strategy).toBe("compact-current-v2");
    const importProgress: Array<{ operation: string; phase: string; percent: number }> = [];
    await importBackup(targetSettings, preview.importToken, "test", {
      includeCredentials: false,
      restoreNativeConversations: true,
      recoveryDir: path.join(targetHome, "recovery"),
      onProgress: (event) => importProgress.push(event)
    });
    expect(importProgress[0]).toMatchObject({ operation: "import", phase: "preparing" });
    expect(importProgress.at(-1)).toMatchObject({ operation: "import", phase: "complete", percent: 100 });

    const targetDb = path.join(targetAgents, "opencode", "opencode.db");
    await expect(runSqliteJson<{ id: string }>(targetDb, "SELECT id FROM session ORDER BY id;")).resolves.toEqual([{ id: "active" }]);
    await expect(runSqliteJson<{ share_url: string | null; permission: string | null }>(targetDb, "SELECT share_url, permission FROM session WHERE id = 'active';")).resolves.toEqual([{ share_url: null, permission: null }]);
    for (const table of ["event", "event_sequence", "account", "credential", "permission", "session_share"]) {
      await expect(runSqliteJson<{ count: number }>(targetDb, `SELECT COUNT(*) AS count FROM ${table};`)).resolves.toEqual([{ count: 0 }]);
    }
  }, 30_000);

  it("merges compatible OpenCode session tables in one native restore", async () => {
    const sourceSettings = await makeSettings();
    const targetSettings = await makeSettings();
    const sourceHome = sourceSettings.panelHome!;
    const targetHome = targetSettings.panelHome!;
    const sourceAgents = path.join(sourceHome, "agent-homes");
    const targetAgents = path.join(targetHome, "agent-homes");
    sourceSettings.agentHomes = {
      codexHome: path.join(sourceAgents, "codex"), claudeHome: path.join(sourceAgents, "claude"),
      antigravityHome: path.join(sourceAgents, "agy"), grokHome: path.join(sourceAgents, "grok"),
      opencodeHome: path.join(sourceAgents, "opencode"), piHome: path.join(sourceAgents, "pi"),
      cursorHome: path.join(sourceAgents, "cursor")
    };
    targetSettings.agentHomes = {
      codexHome: path.join(targetAgents, "codex"), claudeHome: path.join(targetAgents, "claude"),
      antigravityHome: path.join(targetAgents, "agy"), grokHome: path.join(targetAgents, "grok"),
      opencodeHome: path.join(targetAgents, "opencode"), piHome: path.join(targetAgents, "pi"),
      cursorHome: path.join(targetAgents, "cursor")
    };
    await preparePanelDatabases(sourceSettings);
    await preparePanelDatabases(targetSettings);
    const sourceDb = path.join(sourceAgents, "opencode", "opencode.db");
    const targetDb = path.join(targetAgents, "opencode", "opencode.db");
    await fs.mkdir(path.dirname(sourceDb), { recursive: true });
    await fs.mkdir(path.dirname(targetDb), { recursive: true });
    const schema = "CREATE TABLE session (id TEXT PRIMARY KEY, title TEXT, time_updated INTEGER); CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, text TEXT);";
    await runSqlite(sourceDb, `${schema} INSERT INTO session VALUES ('s1', 'Imported', 200); INSERT INTO message VALUES ('m1', 's1', 'hello');`);
    await runSqlite(targetDb, `${schema} INSERT INTO session VALUES ('s1', 'Local', 100);`);

    const archive = path.join(sourceHome, "opencode.zip");
    await exportBackup(sourceSettings, archive, "test", { includeCredentials: false, includeNativeConversations: true });
    const preview = await selectBackupForImport(archive);
    expect(preview.providers.find((provider) => provider.provider === "opencode")?.fileCount).toBe(1);
    await importBackup(targetSettings, preview.importToken, "test", {
      includeCredentials: false,
      restoreNativeConversations: true,
      recoveryDir: path.join(targetHome, "recovery")
    });

    await expect(runSqliteJson<{ title: string; time_updated: number }>(targetDb, "SELECT title, time_updated FROM session WHERE id = 's1';")).resolves.toEqual([{ title: "Imported", time_updated: 200 }]);
    await expect(runSqliteJson<{ id: string; session_id: string; text: string }>(targetDb, "SELECT id, session_id, text FROM message WHERE id = 'm1';")).resolves.toEqual([{ id: "m1", session_id: "s1", text: "hello" }]);
  }, 30_000);
});
