import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { listTaskSessionProjects, listTasks } from "./catalogNotes";
import { parseNoteDocument, type NoteFrontmatter } from "./frontmatter";
import { absFromRelMdPath } from "./paths";
import { taskPromptBody } from "./taskNote";

export interface TaskContextInput {
  readonly panelHome: string;
  readonly catalogDb: string;
  readonly noteId: string;
}

/**
 * The task context a session is injected with: facts only — where the note
 * lives, where the referenced repositories live, where working docs belong.
 * Policy text (branch discipline, review rules) is the note author's to write
 * into the knowledge region; the renderer never editorializes.
 */
export async function renderTaskContext(input: TaskContextInput): Promise<string | undefined> {
  const noteId = input.noteId.trim();
  if (!noteId) return undefined;
  const tasks = await listTasks(input.catalogDb).catch(() => undefined);
  const record = tasks?.find((task) => task.noteId === noteId);
  if (!record) return undefined;

  const notePath = absFromRelMdPath(input.panelHome, record.relMdPath);
  let frontmatter: NoteFrontmatter | undefined;
  let knowledge = "";
  try {
    const doc = parseNoteDocument(await fs.readFile(notePath, "utf8"));
    frontmatter = doc.frontmatter;
    knowledge = knowledgeText(doc.body);
  } catch {
    // An unreadable note degrades to the catalog's facts.
  }

  const sessionProjects = (await listTaskSessionProjects(input.catalogDb))[noteId] ?? [];
  const lines = [
    `# Task: ${record.title || record.filename || noteId} (note: ${notePath})`,
    `Status: ${record.gtdStatus || "inbox"} · Next: ${frontmatter?.next ?? record.work.next ?? "-"} · Decision: ${frontmatter?.decision ?? record.work.decision ?? "-"}`
  ];
  const declared = frontmatter?.projects ?? record.work.projects ?? [];
  const projects = mergeTaskProjects(input.panelHome, declared, sessionProjects);
  if (projects.length > 0) {
    lines.push(`Repos: ${projects.map((item) => `${projectLabel(item)} → ${item}`).join("; ")}`);
  }
  lines.push("Docs: durable → the task note (note_append); throwaway → /tmp. Do not leave scratch files in the repositories.");
  const head = lines.join("\n");
  return knowledge ? `${head}\n\n${knowledge}` : head;
}

/**
 * The context as a file path for `sessionContextFlags`, which embeds file
 * contents (`$(cat <path>)`) — one deterministic file per task, rewritten on
 * every launch so it can never go stale.
 */
export async function writeTaskContextFile(input: TaskContextInput): Promise<string | undefined> {
  const text = await renderTaskContext(input);
  if (!text) return undefined;
  const dir = path.join(os.tmpdir(), "agent-resume-task-context");
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${input.noteId.trim()}.md`);
  await fs.writeFile(file, text, "utf8");
  return file;
}

/** Declared projects keep their order; session-derived ones join when they live outside panel data. */
export function mergeTaskProjects(panelHome: string, declared: readonly string[], sessionProjects: readonly string[]): string[] {
  const merged = new Set(declared.map((entry) => entry.trim()).filter(Boolean));
  for (const projectPath of sessionProjects) {
    if (!insideDir(panelHome, projectPath)) merged.add(projectPath.trim());
  }
  return [...merged];
}

/** The note's background knowledge as prose, without the note's own heading. */
export function knowledgeText(body: string): string {
  return taskPromptBody(body).replace(/^\s*#\s+[^\n]*(?:\n+|$)/, "").trim();
}

function projectLabel(projectPath: string): string {
  return projectPath.replaceAll("\\", "/").split("/").filter(Boolean).at(-1) || projectPath;
}

function insideDir(dir: string, candidate: string): boolean {
  const rel = path.relative(path.resolve(dir), path.resolve(candidate));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}
