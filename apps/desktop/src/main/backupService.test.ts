import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  preparePanelDatabases,
  NotesStore,
  runSqlite,
  runSqliteJson,
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
    await exportBackup(sourceSettings, archive, "test", { includeCredentials: false });
    const preview = await selectBackupForImport(archive);
    await importBackup(targetSettings, preview.importToken, "test", {
      includeCredentials: false,
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
  });
});
