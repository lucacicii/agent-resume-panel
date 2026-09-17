import type { NoteFrontmatter } from "./frontmatter";

/**
 * Task note conventions.
 *
 * A task is a note with `work: true`. Two things are special about it:
 *
 * 1. Its markdown heading is its name; the name itself lives in front-matter
 *    `title`, so every display site reads the plain name.
 * 2. Only the content between the knowledge markers is injected into prompts.
 *    Notes without markers keep the old behaviour (whole body) so hand-written
 *    and pre-existing files never lose content silently.
 */

/** Region of a task note that is injected into agent prompts. */
export const TASK_KNOWLEDGE_BEGIN = "<!-- agent-resume:begin task-knowledge -->";
export const TASK_KNOWLEDGE_END = "<!-- agent-resume:end task-knowledge -->";

/**
 * Markers written before the Workbench task rename. They are still read so an
 * existing note keeps injecting only its marked region, and are replaced with
 * the current markers the next time the note is written.
 */
const LEGACY_KNOWLEDGE_BEGIN = "<!-- agent-resume:begin work-item-knowledge -->";
const LEGACY_KNOWLEDGE_END = "<!-- agent-resume:end work-item-knowledge -->";

/** Name used when a task was created without one. */
export const UNTITLED_TASK_NAME = "未命名任务";

/** Name an untitled task carried before the rename; still treated as untitled. */
export const LEGACY_UNTITLED_TASK_NAME = "未命名工作项";

/** Whether a title is a placeholder rather than a name the user chose. */
export function isUntitledTaskName(name: string | undefined): boolean {
  const value = name?.trim();
  return !value || value === UNTITLED_TASK_NAME || value === LEGACY_UNTITLED_TASK_NAME;
}

const H1_RE = /^\s*#\s+(.+?)\s*$/;

function headingLine(body: string): string | undefined {
  for (const line of body.split(/\r?\n/)) {
    if (H1_RE.test(line)) {
      return line;
    }
  }
  return undefined;
}

function headingText(body: string): string | undefined {
  const line = headingLine(body);
  const match = line ? H1_RE.exec(line) : null;
  return match ? match[1].trim() : undefined;
}

export function isTaskFrontmatter(frontmatter: NoteFrontmatter): boolean {
  return frontmatter.work === true;
}

/**
 * Task name. Front-matter is authoritative; the heading is only a fallback
 * for notes that predate front-matter titles.
 */
export function taskName(frontmatter: NoteFrontmatter): string | undefined {
  const declared = frontmatter.title?.trim();
  return declared || undefined;
}

/**
 * Body handed to the model. The heading is kept — its suffix is the reminder —
 * and only the marked region is included when the note declares one.
 */
export function taskPromptBody(body: string): string {
  const region = knowledgeRegion(body) ?? knowledgeRegion(body, LEGACY_KNOWLEDGE_BEGIN, LEGACY_KNOWLEDGE_END);
  const heading = headingLine(body)?.trim();
  if (!region) {
    return body.trim();
  }
  return [heading, region].filter(Boolean).join("\n\n");
}

/** Marked knowledge region, or `undefined` when the note has none. */
function knowledgeRegion(
  body: string,
  begin: string = TASK_KNOWLEDGE_BEGIN,
  end: string = TASK_KNOWLEDGE_END
): string | undefined {
  const start = body.indexOf(begin);
  const stop = body.indexOf(end);
  if (start < 0 || stop <= start) return undefined;
  return body.slice(start + begin.length, stop).trim();
}

/** Wrap a body's payload in the knowledge region. Idempotent. */
export function ensureTaskKnowledgeRegion(body: string): string {
  if (hasKnowledgeRegion(body)) {
    return body;
  }
  const heading = headingLine(body);
  const rest = (heading ? body.replace(heading, "") : body).trim();
  return [heading?.trim(), TASK_KNOWLEDGE_BEGIN, rest, TASK_KNOWLEDGE_END]
    .filter((part) => part !== undefined && part !== "")
    .join("\n\n");
}

function hasKnowledgeRegion(body: string): boolean {
  return (body.includes(TASK_KNOWLEDGE_BEGIN) && body.includes(TASK_KNOWLEDGE_END))
    || (body.includes(LEGACY_KNOWLEDGE_BEGIN) && body.includes(LEGACY_KNOWLEDGE_END));
}

/** Placeholder region body of a freshly created task. */
export function newTaskBody(name: string): string {
  return ensureTaskKnowledgeRegion(`# ${name}\n`);
}

export interface NormalizedTaskDocument {
  frontmatter: NoteFrontmatter;
  body: string;
}

/**
 * Keep a task document on the convention:
 * - front-matter `title` holds the name,
 * - the heading is the name,
 * - the knowledge region exists.
 *
 * `titleSuffix` is a legacy field from when headings carried a localized
 * reminder suffix; it is read once to strip that suffix from old files, and
 * never written back.
 */
export function normalizeTaskDocument(
  frontmatter: NoteFrontmatter,
  body: string,
  options: { name?: string } = {}
): NormalizedTaskDocument {
  const legacySuffix = frontmatter.titleSuffix?.trim() || "";
  const withoutLegacySuffix = (value: string): string => {
    const candidate = value.trim();
    if (legacySuffix && candidate.endsWith(legacySuffix)) {
      return candidate.slice(0, candidate.length - legacySuffix.length).trim();
    }
    return candidate;
  };

  let name = withoutLegacySuffix(frontmatter.title?.trim() || "");
  if (options.name !== undefined) {
    // An explicit rename wins over the heading.
    const requested = withoutLegacySuffix(options.name);
    if (requested) {
      name = requested;
    }
  } else {
    const edited = headingText(body);
    if (edited) {
      const candidate = withoutLegacySuffix(edited);
      if (candidate) {
        name = candidate;
      }
    }
  }
  if (!name) {
    name = UNTITLED_TASK_NAME;
  }

  const heading = `# ${name}`;
  const currentHeading = headingLine(body);
  const withHeading = currentHeading
    ? body.replace(currentHeading, heading)
    : `${heading}\n\n${body.replace(/^\n+/, "")}`;

  const next: NoteFrontmatter = { ...frontmatter, title: name };
  delete next.titleSuffix;
  return {
    frontmatter: next,
    body: ensureTaskKnowledgeRegion(withHeading)
  };
}
