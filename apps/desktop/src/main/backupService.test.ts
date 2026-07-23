import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  preparePanelDatabases,
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

  it("merges newer catalog rows and vector rows while retaining the destination sync cursor", async () => {
    const sourceSettings = await makeSettings();
    const targetSettings = await makeSettings();
    const sourceHome = sourceSettings.panelHome!;
    const targetHome = targetSettings.panelHome!;
    const sourcePaths = await preparePanelDatabases(sourceSettings);
    const targetPaths = await preparePanelDatabases(targetSettings);

    await runSqlite(sourcePaths.catalogDb, `INSERT INTO sessions (provider, agent_session_id, title, project_path, updated_at_ms) VALUES ('codex', 'session-1', 'Imported', '/source', 200); INSERT INTO sync_state (provider, last_sync_at_ms) VALUES ('codex', 200);`);
    await runSqlite(sourcePaths.desktopDb, `INSERT INTO session_embeddings (provider, agent_session_id, title, summary_preview, embedding_json, content_hash, embedding_key, updated_at_ms) VALUES ('codex', 'session-1', 'Imported', 'summary', '[0.1,0.2]', 'hash-new', 'model-a', 200);`);
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

    expect(sessions).toEqual([{ title: "Imported", updated_at_ms: 200 }]);
    expect(vectors).toEqual([{ embedding_key: "model-a", content_hash: "hash-new" }]);
    expect(sync).toEqual([{ last_sync_at_ms: 999 }]);
  }, 30_000);
});
