import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ensureExtensionCatalogSchema } from "@agent-resume/core";
import {
  ensureWorkItemWorkspace,
  renderAddressTable,
  workItemWorkspaceDir,
  type WorkItemAddress
} from "./workItemWorkspace";

const homes: string[] = [];

async function setup(): Promise<{ panelHome: string; catalogDb: string; address: WorkItemAddress }> {
  const panelHome = await fs.mkdtemp(path.join(os.tmpdir(), "agent-resume-workspace-"));
  homes.push(panelHome);
  const catalogDb = path.join(panelHome, "catalog.db");
  await ensureExtensionCatalogSchema(catalogDb);
  const projectPath = path.join(panelHome, "app");
  await fs.mkdir(projectPath, { recursive: true });
  const address: WorkItemAddress = {
    noteId: "wi-1",
    title: "Cross-repo feature",
    status: "next",
    next: "Wire it",
    decision: "Show connecting?",
    noteRelPath: "notes/library/wi.md",
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

describe("workItemWorkspace", () => {
  it("allocates a deterministic directory and writes the address table", async () => {
    const { panelHome, catalogDb, address } = await setup();
    const dir = workItemWorkspaceDir(panelHome, "wi-1");
    expect(dir).toBe(path.join(panelHome, ".desktop", "workspaces", "wi-1"));

    const first = await ensureWorkItemWorkspace({ panelHome, catalogDb, address });
    expect(first.dir).toBe(dir);
    expect(first.updated).toBe(true);

    const agents = await fs.readFile(path.join(dir, "AGENTS.md"), "utf8");
    expect(agents).toContain("# Work item: Cross-repo feature");
    expect(agents).toContain(`- app → ${address.projects[0].path}`);
    expect(agents).toContain("(path not found on this machine)");
    expect(agents).toContain("Full note: notes/library/wi.md");
    expect(await fs.readFile(path.join(dir, "CLAUDE.md"), "utf8")).toBe(agents);
  });

  it("is idempotent and keeps user text outside the managed block", async () => {
    const { panelHome, catalogDb, address } = await setup();
    const dir = workItemWorkspaceDir(panelHome, "wi-1");
    await ensureWorkItemWorkspace({ panelHome, catalogDb, address });

    const file = path.join(dir, "AGENTS.md");
    await fs.appendFile(file, "\n## My rules\nAlways run pnpm.\n", "utf8");
    const second = await ensureWorkItemWorkspace({ panelHome, catalogDb, address });
    expect(second.updated).toBe(false);

    const content = await fs.readFile(file, "utf8");
    expect(content).toContain("## My rules");
    expect(content.match(/# Work item: Cross-repo feature/g)).toHaveLength(1);
  });

  it("preserves edits made inside the managed block instead of destroying them", async () => {
    const { panelHome, catalogDb, address } = await setup();
    const dir = workItemWorkspaceDir(panelHome, "wi-1");
    await ensureWorkItemWorkspace({ panelHome, catalogDb, address });

    const file = path.join(dir, "AGENTS.md");
    const edited = (await fs.readFile(file, "utf8")).replace("- app →", "- app (edited by user) →");
    await fs.writeFile(file, edited, "utf8");

    const next = await ensureWorkItemWorkspace({ panelHome, catalogDb, address });
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
    const dir = workItemWorkspaceDir(panelHome, "wi-1");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "CLAUDE.md"), "# My project rules\n", "utf8");

    await ensureWorkItemWorkspace({ panelHome, catalogDb, address });
    const content = await fs.readFile(path.join(dir, "CLAUDE.md"), "utf8");
    expect(content.startsWith("# My project rules")).toBe(true);
    expect(content).toContain("# Work item: Cross-repo feature");
  });

  it("stops managing a file that opts out with the disable marker", async () => {
    const { panelHome, catalogDb, address } = await setup();
    const dir = workItemWorkspaceDir(panelHome, "wi-1");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "AGENTS.md"), "<!-- agent-resume:disable -->\n# Mine\n", "utf8");

    await ensureWorkItemWorkspace({ panelHome, catalogDb, address });
    // The opt-out is per file: AGENTS.md is left alone, CLAUDE.md is still managed.
    expect(await fs.readFile(path.join(dir, "AGENTS.md"), "utf8")).toBe("<!-- agent-resume:disable -->\n# Mine\n");
    expect(await fs.readFile(path.join(dir, "CLAUDE.md"), "utf8")).toContain("# Work item: Cross-repo feature");
  });

  it("renders a compact table for prompt injection", () => {
    const table = renderAddressTable({
      noteId: "wi-1",
      title: "T",
      status: "next",
      noteRelPath: "notes/library/wi.md",
      projects: [{ path: "/work/app", label: "app", exists: true }]
    });
    expect(table).toContain("Repositories referenced by this work item:");
    expect(table).toContain("- app → /work/app");
    expect(table).not.toContain("This directory is the work item's neutral workspace");
  });
});
