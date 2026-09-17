import type { NoteFrontmatter } from "./frontmatter";

/**
 * Work-item note conventions.
 *
 * A work item is a note with `work: true`. Two things are special about it:
 *
 * 1. Its markdown heading is its name; the name itself lives in front-matter
 *    `title`, so every display site reads the plain name.
 * 2. Only the content between the knowledge markers is injected into prompts.
 *    Notes without markers keep the old behaviour (whole body) so hand-written
 *    and pre-existing files never lose content silently.
 */

/** Region of a work-item note that is injected into agent prompts. */
export const WORK_ITEM_KNOWLEDGE_BEGIN = "<!-- agent-resume:begin work-item-knowledge -->";
export const WORK_ITEM_KNOWLEDGE_END = "<!-- agent-resume:end work-item-knowledge -->";

/** Name used when a work item was created without one. */
export const UNTITLED_WORK_ITEM_NAME = "未命名工作项";

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

export function isWorkItemFrontmatter(frontmatter: NoteFrontmatter): boolean {
  return frontmatter.work === true;
}

/**
 * Work-item name. Front-matter is authoritative; the heading is only a fallback
 * for notes that predate front-matter titles.
 */
export function workItemName(frontmatter: NoteFrontmatter): string | undefined {
  const declared = frontmatter.title?.trim();
  return declared || undefined;
}

/**
 * Body handed to the model. The heading is kept — its suffix is the reminder —
 * and only the marked region is included when the note declares one.
 */
export function workItemPromptBody(body: string): string {
  const start = body.indexOf(WORK_ITEM_KNOWLEDGE_BEGIN);
  const end = body.indexOf(WORK_ITEM_KNOWLEDGE_END);
  const heading = headingLine(body)?.trim();
  if (start < 0 || end <= start) {
    return body.trim();
  }
  const region = body.slice(start + WORK_ITEM_KNOWLEDGE_BEGIN.length, end).trim();
  return [heading, region].filter(Boolean).join("\n\n");
}

/** Wrap a body's payload in the knowledge region. Idempotent. */
export function ensureWorkItemKnowledgeRegion(body: string): string {
  if (body.includes(WORK_ITEM_KNOWLEDGE_BEGIN) && body.includes(WORK_ITEM_KNOWLEDGE_END)) {
    return body;
  }
  const heading = headingLine(body);
  const rest = (heading ? body.replace(heading, "") : body).trim();
  return [heading?.trim(), WORK_ITEM_KNOWLEDGE_BEGIN, rest, WORK_ITEM_KNOWLEDGE_END]
    .filter((part) => part !== undefined && part !== "")
    .join("\n\n");
}

/** Placeholder region body of a freshly created work item. */
export function newWorkItemBody(name: string): string {
  return ensureWorkItemKnowledgeRegion(`# ${name}\n`);
}

export interface NormalizedWorkItemDocument {
  frontmatter: NoteFrontmatter;
  body: string;
}

/**
 * Keep a work-item document on the convention:
 * - front-matter `title` holds the name,
 * - the heading is the name,
 * - the knowledge region exists.
 *
 * `titleSuffix` is a legacy field from when headings carried a localized
 * reminder suffix; it is read once to strip that suffix from old files, and
 * never written back.
 */
export function normalizeWorkItemDocument(
  frontmatter: NoteFrontmatter,
  body: string,
  options: { name?: string } = {}
): NormalizedWorkItemDocument {
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
    name = UNTITLED_WORK_ITEM_NAME;
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
    body: ensureWorkItemKnowledgeRegion(withHeading)
  };
}
