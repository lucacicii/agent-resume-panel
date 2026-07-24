import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  NotesStore,
  createNoteMcpServer,
  NoteMcpClient,
  appendSessionExecutionCheckpoint,
  assertExecutionNoteWritable,
  preparePanelDatabases,
  runSqlite,
  type PanelSettings
} from "@agent-resume/core";

const roots: string[] = [];

async function createContext() {
  const panelHome = await fs.mkdtemp(path.join(os.tmpdir(), "agent-resume-execution-note-test-"));
  roots.push(panelHome);
  const settings = { panelHome } as PanelSettings;
  const paths = await preparePanelDatabases(settings);
  await runSqlite(
    paths.catalogDb,
    "INSERT INTO sessions (provider, agent_session_id, title, project_path, updated_at_ms) VALUES ('codex', 'session-1', 'Test session', '/project', 100);"
  );
  const notesStore = new NotesStore(paths.catalogDb, panelHome);
  await notesStore.initialize();
  return { notesStore, catalogDb: paths.catalogDb, desktopDb: paths.desktopDb };
}

describe("session execution notes", () => {
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
  });

  it("reuses one protected timeline and appends checkpoints without changing GTD", async () => {
    const ctx = await createContext();
    const started = await appendSessionExecutionCheckpoint(ctx, {
      provider: "codex",
      sessionId: "session-1",
      status: "started",
      source: "desktop",
      nowMs: 1_000
    });
    const completed = await appendSessionExecutionCheckpoint(ctx, {
      provider: "codex",
      sessionId: "session-1",
      status: "completed",
      description: "Verified locally",
      source: "mcp",
      nowMs: 2_000
    });

    expect(completed.noteId).toBe(started.noteId);
    await expect(assertExecutionNoteWritable(ctx.desktopDb, started.noteId)).rejects.toThrow("system-managed");
    const content = await ctx.notesStore.readNoteContent(started.noteId);
    expect(content).toContain("| started | desktop");
    expect(content).toContain("| completed | mcp | Verified locally");

    const client = new NoteMcpClient();
    await client.connectInMemory(createNoteMcpServer({
      notesStore: ctx.notesStore,
      catalogDb: ctx.catalogDb,
      dbPath: ctx.desktopDb,
      panelHome: ctx.notesStore.getPanelHome()
    }));
    expect((await client.listTools()).some((tool) => tool.name === "session_note_checkpoint")).toBe(true);
    const checkpoint = await client.callTool("session_note_checkpoint", {
      provider: "codex",
      sessionId: "session-1",
      status: "blocked",
      description: "Waiting for input"
    });
    await client.stop();
    expect(checkpoint.isError, JSON.stringify(checkpoint.content)).not.toBe(true);
    expect(await ctx.notesStore.readNoteContent(started.noteId)).toContain("| blocked | mcp | Waiting for input");
  }, 30_000);
});
