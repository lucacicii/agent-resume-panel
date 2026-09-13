import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { getCatalogMeta, setCatalogMeta } from "@agent-resume/core";

/**
 * Work-item workspace + address table.
 *
 * A work item that references several repositories cannot use any single repo
 * as its cwd, so sessions may run in a neutral, deterministically allocated
 * workspace directory. The address table — where each referenced repository
 * actually lives — is written into `AGENTS.md` / `CLAUDE.md` there so agents
 * read it automatically (Workbench sessions get no injected prompt).
 *
 * The workspace path is derived from the note id: allocated once, stable
 * forever, nothing persisted.
 */

const BEGIN = "<!-- agent-resume:begin work-item-address -->";
const END = "<!-- agent-resume:end work-item-address -->";
/** A user leaves this in the file to take ownership; we then stop managing it. */
const DISABLE = "<!-- agent-resume:disable -->";
const HASH_KEY_PREFIX = "work_item_workspace_hash:";

export type WorkItemAddressProject = {
  path: string;
  label: string;
  /** False when the path does not exist on this machine (e.g. synced from another Mac). */
  exists: boolean;
};

export type WorkItemAddress = {
  noteId: string;
  title: string;
  status?: string;
  next?: string;
  decision?: string;
  /** Note path relative to the panel home, for pointing the agent at the full note. */
  noteRelPath: string;
  projects: WorkItemAddressProject[];
};

/** Deterministic workspace directory: same note id → same path, forever. */
export function workItemWorkspaceDir(panelHome: string, noteId: string): string {
  return path.join(panelHome, ".desktop", "workspaces", noteId);
}

/** The address table itself, shared by the workspace files and the IM preamble. */
export function renderAddressTable(address: WorkItemAddress, workspaceDir?: string): string {
  const lines = [
    `# Work item: ${address.title || address.noteId}`,
    `Status: ${address.status || "inbox"} · Next: ${address.next || "-"} · Decision: ${address.decision || "-"}`,
    ""
  ];
  if (workspaceDir) {
    lines.push(
      "This directory is the work item's neutral workspace (it is not a git repository).",
      ""
    );
  }
  lines.push(
    "Repositories referenced by this work item:",
    ...(address.projects.length
      ? address.projects.map((project) => `- ${project.label} → ${project.path}${project.exists ? "" : "  (path not found on this machine)"}`)
      : ["- (none yet) — add a project from the work item header, or link a session to one"]),
    "",
    "cd into the repository you need before running project commands.",
    "Shared artifacts and notes go under .arp/.",
    `Full note: ${address.noteRelPath}`
  );
  return lines.join("\n");
}

function hashText(value: string): string {
  return createHash("sha1").update(value).digest("hex");
}

function stripMarkers(block: string): string {
  return block.replace(BEGIN, "").replace(END, "").trim();
}

/**
 * (Re)write one managed block, never losing user text:
 * - no markers yet  → append the block (survives e.g. an agent rewriting the file)
 * - block unchanged → no write at all (keeps mtime quiet)
 * - block edited    → keep the edited copy below and regenerate (policy b)
 * - `disable` marker → leave the file alone entirely
 */
async function upsertManagedBlock(filePath: string, block: string, catalogDb: string): Promise<boolean> {
  let existing = "";
  try {
    existing = await fs.readFile(filePath, "utf8");
  } catch {
    // new file
  }
  if (existing.includes(DISABLE)) return false;

  const start = existing.indexOf(BEGIN);
  const end = existing.indexOf(END);
  const hashKey = `${HASH_KEY_PREFIX}${filePath}`;
  const writtenHash = await getCatalogMeta(catalogDb, hashKey).catch(() => undefined);
  const nextHash = hashText(block);

  let next: string;
  if (start >= 0 && end > start) {
    const currentBlock = existing.slice(start, end + END.length);
    if (currentBlock === block) return false;
    const editedByUser = Boolean(writtenHash) && hashText(currentBlock) !== writtenHash;
    const before = existing.slice(0, start);
    const after = existing.slice(end + END.length).replace(/^\n+/, "\n");
    const preserved = editedByUser
      ? `\n\n<!-- preserved from your edit of the managed block -->\n${stripMarkers(currentBlock)}\n`
      : "";
    next = `${before}${block}${after}${preserved}`;
  } else if (existing.trim()) {
    next = `${existing.replace(/\s*$/, "")}\n\n${block}\n`;
  } else {
    next = `${block}\n`;
  }

  await fs.writeFile(filePath, next, "utf8");
  await setCatalogMeta(catalogDb, hashKey, nextHash).catch(() => undefined);
  return true;
}

/**
 * Allocate the workspace and refresh the address table.
 * Write failures must never block a session — callers treat this as best-effort.
 */
export async function ensureWorkItemWorkspace(input: {
  panelHome: string;
  catalogDb: string;
  address: WorkItemAddress;
}): Promise<{ dir: string; updated: boolean }> {
  const dir = workItemWorkspaceDir(input.panelHome, input.address.noteId);
  await fs.mkdir(dir, { recursive: true });
  const block = [BEGIN, renderAddressTable(input.address, dir), END].join("\n");
  let updated = false;
  for (const fileName of ["AGENTS.md", "CLAUDE.md"]) {
    updated = (await upsertManagedBlock(path.join(dir, fileName), block, input.catalogDb)) || updated;
  }
  return { dir, updated };
}
