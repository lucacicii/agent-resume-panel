import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { desktopDataDir, getCatalogMeta, setCatalogMeta, taskPromptBody } from "@agent-resume/core";

/**
 * Task workspace + address table.
 *
 * A task that references several repositories cannot use any single repo
 * as its cwd, so sessions may run in a neutral, deterministically allocated
 * workspace directory. The address table — where each referenced repository
 * actually lives — and the note's background knowledge are written into
 * `AGENTS.md` / `CLAUDE.md` there so agents read them automatically (Workbench
 * sessions get no injected prompt).
 *
 * The workspace path is derived from the note id: allocated once, stable
 * forever, nothing persisted.
 */

const BEGIN = "<!-- agent-resume:begin task-address -->";
const END = "<!-- agent-resume:end task-address -->";
/**
 * Markers written before the Workbench task rename. Still located so an existing
 * workspace file migrates in place instead of growing a second managed block.
 */
const LEGACY_BEGIN = "<!-- agent-resume:begin work-item-address -->";
const LEGACY_END = "<!-- agent-resume:end work-item-address -->";
/** A user leaves this in the file to take ownership; we then stop managing it. */
const DISABLE = "<!-- agent-resume:disable -->";
const HASH_KEY_PREFIX = "work_item_workspace_hash:";

type TaskAddressProject = {
  path: string;
  label: string;
  /** False when the path does not exist on this machine (e.g. synced from another Mac). */
  exists: boolean;
};

export type TaskAddress = {
  noteId: string;
  title: string;
  status?: string;
  next?: string;
  decision?: string;
  /** Absolute path of the note file, so agents running in any cwd can read it. */
  noteAbsPath: string;
  projects: TaskAddressProject[];
};

/** Deterministic workspace directory: same note id → same path, forever. */
export function taskWorkspaceDir(panelHome: string, noteId: string): string {
  return path.join(desktopDataDir(panelHome), "workspaces", noteId);
}

/**
 * True for directories the panel owns itself (`<panelHome>/.desktop`: task
 * workspaces, scratch sessions, stores). They are implementation details of the
 * app, never repositories a task references, so they must not leak into a
 * task's project list or its address table.
 */
export function isPanelInternalPath(panelHome: string, candidate: string): boolean {
  const root = path.resolve(desktopDataDir(panelHome));
  const target = path.resolve(candidate);
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/**
 * The projects a task references: the ones declared on its note plus the
 * working directories of its linked sessions. A session that ran in the panel's
 * own workspace directory does not make that directory a repository, so those
 * cwds are dropped; the declared list is the user's explicit choice and is kept.
 */
export function mergeTaskProjects(input: {
  panelHome: string;
  declared: readonly string[];
  sessionProjects: readonly string[];
}): string[] {
  const merged = new Set(input.declared);
  for (const projectPath of input.sessionProjects) {
    if (!isPanelInternalPath(input.panelHome, projectPath)) merged.add(projectPath);
  }
  return [...merged];
}

/**
 * The block file a session started outside the workspace is injected with.
 * Sessions already running in the workspace read the file from their working
 * directory, so they get no extra flag.
 */
export function sessionContextFile(workspaceDir: string, sessionCwd: string): string | undefined {
  if (path.resolve(workspaceDir) === path.resolve(sessionCwd)) return undefined;
  return path.join(workspaceDir, "AGENTS.md");
}

/** The address table itself, shared by the workspace files and the IM preamble. */
export function renderAddressTable(address: TaskAddress, workspaceDir?: string): string {
  const lines = [
    `# Task: ${address.title || address.noteId}`,
    `Status: ${address.status || "inbox"} · Next: ${address.next || "-"} · Decision: ${address.decision || "-"}`,
    ""
  ];
  if (workspaceDir) {
    lines.push(
      "This directory is the task's neutral workspace (it is not a git repository).",
      ""
    );
  }
  lines.push(
    "Repositories referenced by this task:",
    ...(address.projects.length
      ? address.projects.map((project) => `- ${project.label} → ${project.path}${project.exists ? "" : "  (path not found on this machine)"}`)
      : ["- (none yet) — add a project from the task header, or link a session to one"]),
    "",
    "cd into the repository you need before running project commands.",
    "Shared artifacts and notes go under .arp/.",
    `Full note: ${address.noteAbsPath} (or the note_read MCP tool, noteId ${address.noteId})`
  );
  return lines.join("\n");
}

function hashText(value: string): string {
  return createHash("sha1").update(value).digest("hex");
}

function stripMarkers(block: string): string {
  return [BEGIN, END, LEGACY_BEGIN, LEGACY_END]
    .reduce((value, marker) => value.replace(marker, ""), block)
    .trim();
}

/** The managed block in an existing file, under either marker generation. */
function findManagedBlock(existing: string): { start: number; end: number; endMarker: string } | null {
  for (const [beginMarker, endMarker] of [[BEGIN, END], [LEGACY_BEGIN, LEGACY_END]] as const) {
    const start = existing.indexOf(beginMarker);
    const end = existing.indexOf(endMarker);
    if (start >= 0 && end > start) return { start, end, endMarker };
  }
  return null;
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
  const located = findManagedBlock(existing);
  if (located) {
    const currentBlock = existing.slice(located.start, located.end + located.endMarker.length);
    if (currentBlock === block) return false;
    const editedByUser = Boolean(writtenHash) && hashText(currentBlock) !== writtenHash;
    const before = existing.slice(0, located.start);
    const after = existing.slice(located.end + located.endMarker.length).replace(/^\n+/, "\n");
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
 * The note's background knowledge as prose: what an agent should know about the
 * task, without the note's own `# <name><suffix>` heading — the managed
 * block already carries the title.
 */
export function taskKnowledgeText(body: string): string {
  return taskPromptBody(body).replace(/^\s*#\s+[^\n]*(?:\n+|$)/, "").trim();
}

/**
 * Allocate the workspace and refresh the address table.
 * Write failures must never block a session — callers treat this as best-effort.
 */
export async function ensureTaskWorkspace(input: {
  panelHome: string;
  catalogDb: string;
  address: TaskAddress;
  /** Note knowledge region; omitted when the note has none. */
  knowledge?: string;
}): Promise<{ dir: string; updated: boolean }> {
  const dir = taskWorkspaceDir(input.panelHome, input.address.noteId);
  await fs.mkdir(dir, { recursive: true });
  const knowledge = input.knowledge?.trim();
  const block = [
    BEGIN,
    renderAddressTable(input.address, dir),
    knowledge ? ["", "## Background knowledge (from the note)", "", knowledge].join("\n") : "",
    END
  ].filter((part) => part !== "").join("\n");
  let updated = false;
  for (const fileName of ["AGENTS.md", "CLAUDE.md"]) {
    updated = (await upsertManagedBlock(path.join(dir, fileName), block, input.catalogDb)) || updated;
  }
  return { dir, updated };
}
