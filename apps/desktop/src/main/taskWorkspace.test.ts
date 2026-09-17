import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ensureExtensionCatalogSchema } from "@agent-resume/core";
import {
  ensureTaskWorkspace,
  isPanelInternalPath,
  mergeTaskProjects,
  renderAddressTable,
  sessionContextFile,
  taskKnowledgeText,
  taskWorkspaceDir,
  type TaskAddress
} from "./taskWorkspace";

const homes: string[] = [];

async function setup(): Promise<{ panelHome: string; catalogDb: string; address: TaskAddress }> {
  const panelHome = await fs.mkdtemp(path.join(os.tmpdir(), "agent-resume-workspace-"));
  homes.push(panelHome);
  const catalogDb = path.join(panelHome, "catalog.db");
  await ensureExtensionCatalogSchema(catalogDb);
  const projectPath = path.join(panelHome, "app");
  await fs.mkdir(projectPath, { recursive: true });
  const address: TaskAddress = {
    noteId: "wi-1",
    title: "Cross-repo feature",
    status: "next",
    next: "Wire it",
    decision: "Show connecting?",
    noteAbsPath: path.join(panelHome, "notes", "library", "wi.md"),
    projects: [
      { path: projectPath, label: "app", exists: true },
      { path: path.join(panelHome, "missing"), label: "api", exists: false }
    ]
  };
  return { panelHome, catalogDb, address };
}

afterEach(async () => {
  await Promise.all(homes.splice(0).map((home) => fs.rm(home, { recursive: true, force: true })));
});

describe("taskWorkspace", () => {
  it("allocates a deterministic directory and writes the address table", async () => {
    const { panelHome, catalogDb, address } = await setup();
    const dir = taskWorkspaceDir(panelHome, "wi-1");
    expect(dir).toBe(path.join(panelHome, ".desktop", "workspaces", "wi-1"));

    const first = await ensureTaskWorkspace({ panelHome, catalogDb, address });
    expect(first.dir).toBe(dir);
    expect(first.updated).toBe(true);

    const agents = await fs.readFile(path.join(dir, "AGENTS.md"), "utf8");
    expect(agents).toContain("# Task: Cross-repo feature");
    expect(agents).toContain(`- app → ${address.projects[0].path}`);
    expect(agents).toContain("(path not found on this machine)");
    expect(agents).toContain(`Full note: ${address.noteAbsPath} (or the note_read MCP tool, noteId wi-1)`);
    expect(await fs.readFile(path.join(dir, "CLAUDE.md"), "utf8")).toBe(agents);
  });

  it("is idempotent and keeps user text outside the managed block", async () => {
    const { panelHome, catalogDb, address } = await setup();
    const dir = taskWorkspaceDir(panelHome, "wi-1");
    await ensureTaskWorkspace({ panelHome, catalogDb, address });

    const file = path.join(dir, "AGENTS.md");
    await fs.appendFile(file, "\n## My rules\nAlways run pnpm.\n", "utf8");
    const second = await ensureTaskWorkspace({ panelHome, catalogDb, address });
    expect(second.updated).toBe(false);

    const content = await fs.readFile(file, "utf8");
    expect(content).toContain("## My rules");
    expect(content.match(/# Task: Cross-repo feature/g)).toHaveLength(1);
  });

  it("preserves edits made inside the managed block instead of destroying them", async () => {
    const { panelHome, catalogDb, address } = await setup();
    const dir = taskWorkspaceDir(panelHome, "wi-1");
    await ensureTaskWorkspace({ panelHome, catalogDb, address });

    const file = path.join(dir, "AGENTS.md");
    const edited = (await fs.readFile(file, "utf8")).replace("- app →", "- app (edited by user) →");
    await fs.writeFile(file, edited, "utf8");

    const next = await ensureTaskWorkspace({ panelHome, catalogDb, address });
    expect(next.updated).toBe(true);
    const content = await fs.readFile(file, "utf8");
    // The regenerated table wins...
    expect(content).toContain("- app →");
    // ...and the user's version is kept below, not lost.
    expect(content).toContain("preserved from your edit");
    expect(content).toContain("edited by user");
  });

  it("appends the managed block to a pre-existing user file", async () => {
    const { panelHome, catalogDb, address } = await setup();
    const dir = taskWorkspaceDir(panelHome, "wi-1");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "CLAUDE.md"), "# My project rules\n", "utf8");

    await ensureTaskWorkspace({ panelHome, catalogDb, address });
    const content = await fs.readFile(path.join(dir, "CLAUDE.md"), "utf8");
    expect(content.startsWith("# My project rules")).toBe(true);
    expect(content).toContain("# Task: Cross-repo feature");
  });

  it("stops managing a file that opts out with the disable marker", async () => {
    const { panelHome, catalogDb, address } = await setup();
    const dir = taskWorkspaceDir(panelHome, "wi-1");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "AGENTS.md"), "<!-- agent-resume:disable -->\n# Mine\n", "utf8");

    await ensureTaskWorkspace({ panelHome, catalogDb, address });
    // The opt-out is per file: AGENTS.md is left alone, CLAUDE.md is still managed.
    expect(await fs.readFile(path.join(dir, "AGENTS.md"), "utf8")).toBe("<!-- agent-resume:disable -->\n# Mine\n");
    expect(await fs.readFile(path.join(dir, "CLAUDE.md"), "utf8")).toContain("# Task: Cross-repo feature");
  });

  it("carries the note's background knowledge into the managed block", async () => {
    const { panelHome, catalogDb, address } = await setup();
    const dir = taskWorkspaceDir(panelHome, "wi-1");

    await ensureTaskWorkspace({ panelHome, catalogDb, address, knowledge: "The API lives in api/.\nRun pnpm test first." });
    const agents = await fs.readFile(path.join(dir, "AGENTS.md"), "utf8");
    expect(agents).toContain("## Background knowledge (from the note)");
    expect(agents).toContain("The API lives in api/.\nRun pnpm test first.");
    expect(agents).toContain(`Full note: ${address.noteAbsPath}`);
    expect(await fs.readFile(path.join(dir, "CLAUDE.md"), "utf8")).toBe(agents);

    // Editing the knowledge counts as a change, so the block is regenerated.
    const next = await ensureTaskWorkspace({ panelHome, catalogDb, address, knowledge: "Rewritten." });
    expect(next.updated).toBe(true);
    const edited = await fs.readFile(path.join(dir, "AGENTS.md"), "utf8");
    expect(edited).toContain("Rewritten.");
    expect(edited).not.toContain("The API lives in api/.");

    // Same knowledge again → nothing to write.
    expect((await ensureTaskWorkspace({ panelHome, catalogDb, address, knowledge: "Rewritten." })).updated).toBe(false);
  });

  it("omits the knowledge section entirely when the note has none", async () => {
    const { panelHome, catalogDb, address } = await setup();
    const dir = taskWorkspaceDir(panelHome, "wi-1");

    await ensureTaskWorkspace({ panelHome, catalogDb, address, knowledge: "   " });
    expect(await fs.readFile(path.join(dir, "AGENTS.md"), "utf8")).not.toContain("Background knowledge");
  });

  it("drops the note's own heading from the knowledge it injects", () => {
    // Marked region: heading out, payload in.
    expect(taskKnowledgeText(
      "# Multi-repo\n\n<!-- agent-resume:begin task-knowledge -->\n\nShip the thing.\n\n<!-- agent-resume:end task-knowledge -->\n"
    )).toBe("Ship the thing.");
    // Unmarked note: the whole body is the knowledge, minus the heading.
    expect(taskKnowledgeText("# Hand written\n\nNotes here.\n")).toBe("Notes here.");
    expect(taskKnowledgeText("# Only a heading\n")).toBe("");
  });

  it("renders a compact table for prompt injection", () => {
    const table = renderAddressTable({
      noteId: "wi-1",
      title: "T",
      status: "next",
      noteAbsPath: "/panel/notes/library/wi.md",
      projects: [{ path: "/work/app", label: "app", exists: true }]
    });
    expect(table).toContain("Repositories referenced by this task:");
    expect(table).toContain("- app → /work/app");
    expect(table).toContain("Full note: /panel/notes/library/wi.md (or the note_read MCP tool, noteId wi-1)");
    expect(table).not.toContain("This directory is the task's neutral workspace");
  });

  it("treats the panel's own data directory as internal, not as a task project", async () => {
    const { panelHome } = await setup();
    expect(isPanelInternalPath(panelHome, taskWorkspaceDir(panelHome, "wi-1"))).toBe(true);
    expect(isPanelInternalPath(panelHome, path.join(panelHome, ".desktop", "scratch", "session-1"))).toBe(true);
    expect(isPanelInternalPath(panelHome, path.join(panelHome, ".desktop"))).toBe(true);
    // A real repository — including one next to, or named like, the internal tree.
    expect(isPanelInternalPath(panelHome, path.join(panelHome, "app"))).toBe(false);
    expect(isPanelInternalPath(panelHome, path.join(panelHome, ".desktop-2", "app"))).toBe(false);
    expect(isPanelInternalPath(panelHome, "/work/app")).toBe(false);
  });

  it("merges declared projects with session cwds but drops the panel's own workspace", async () => {
    const { panelHome } = await setup();
    const workspace = taskWorkspaceDir(panelHome, "wi-1");
    expect(mergeTaskProjects({
      panelHome,
      declared: [path.join(panelHome, "app")],
      sessionProjects: [workspace, path.join(panelHome, "app"), path.join(panelHome, "api")]
    })).toEqual([path.join(panelHome, "app"), path.join(panelHome, "api")]);
  });

  it("identifies when a session needs an extra context file injected", () => {
    const ws = "/Users/lucas/.agent-resume-panel/.desktop/workspaces/wi-1";
    // Running in the workspace: agent already has AGENTS.md in cwd.
    expect(sessionContextFile(ws, ws)).toBeUndefined();
    expect(sessionContextFile(ws, `${ws}/`)).toBeUndefined();
    // Running in a repository: inject the workspace's AGENTS.md.
    expect(sessionContextFile(ws, "/work/app")).toBe(path.join(ws, "AGENTS.md"));
  });
});
