import type { NoteFrontmatter } from "./frontmatter";

/**
 * Work-item note conventions.
 *
 * A work item is a note with `work: true`. Two things are special about it:
 *
 * 1. Its markdown heading is `<name><suffix>`, where the suffix reminds the
 *    reader that this note is consumed by agents. The name itself lives in
 *    front-matter `title`, so every display site reads the plain name.
 * 2. Only the content between the knowledge markers is injected into prompts.
 *    Notes without markers keep the old behaviour (whole body) so hand-written
 *    and pre-existing files never lose content silently.
 */

/** Region of a work-item note that is injected into agent prompts. */
export const WORK_ITEM_KNOWLEDGE_BEGIN = "<!-- agent-resume:begin work-item-knowledge -->";
export const WORK_ITEM_KNOWLEDGE_END = "<!-- agent-resume:end work-item-knowledge -->";

/** Used when a caller (e.g. the MCP server) has no UI locale to localize with. */
export const DEFAULT_WORK_ITEM_TITLE_SUFFIX = "-背景知识(会被AI索引)";

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
export function newWorkItemBody(name: string, suffix: string): string {
  return ensureWorkItemKnowledgeRegion(`# ${name}${suffix}\n`);
}

export interface NormalizedWorkItemDocument {
  frontmatter: NoteFrontmatter;
  body: string;
}

/**
 * Keep a work-item document on the convention:
 * - front-matter `title` holds the name,
 * - the heading is `<name><suffix>`,
 * - the knowledge region exists.
 *
 * The suffix is inherited from the file's previous heading rather than matched
 * against a translation table, so a localized suffix (or a hand-edited one)
 * survives renaming, and switching UI language never rewrites existing files.
 */
export function normalizeWorkItemDocument(
  frontmatter: NoteFrontmatter,
  body: string,
  defaultSuffix: string,
  options: { name?: string } = {}
): NormalizedWorkItemDocument {
  const previousName = frontmatter.title?.trim() || undefined;
  const declaredSuffix = frontmatter.titleSuffix?.trim() || undefined;
  const previousHeading = headingText(body);
  // A file declares its suffix once. Only pre-convention files (no declared
  // suffix) need the heading to be interpreted as `<name><suffix>`.
  let suffix = declaredSuffix || defaultSuffix;
  if (!declaredSuffix && previousName && previousHeading && previousHeading.startsWith(previousName)) {
    const inherited = previousHeading.slice(previousName.length).trim();
    if (inherited) {
      suffix = inherited;
    }
  }

  const withoutSuffix = (value: string): string => {
    let candidate = value.trim();
    if (suffix && candidate.endsWith(suffix)) {
      candidate = candidate.slice(0, candidate.length - suffix.length).trim();
    }
    return candidate;
  };

  let name = previousName || "";
  if (options.name !== undefined) {
    // An explicit rename wins over the heading; the suffix is stripped so it is
    // never applied twice.
    const requested = withoutSuffix(options.name);
    if (requested) {
      name = requested;
    }
  } else {
    const edited = headingText(body);
    if (edited) {
      const candidate = withoutSuffix(edited);
      if (candidate) {
        name = candidate;
      }
    }
  }
  if (!name) {
    name = UNTITLED_WORK_ITEM_NAME;
  }

  const heading = `# ${name}${suffix}`;
  const currentHeading = headingLine(body);
  const withHeading = currentHeading
    ? body.replace(currentHeading, heading)
    : `${heading}\n\n${body.replace(/^\n+/, "")}`;

  return {
    frontmatter: { ...frontmatter, title: name, titleSuffix: suffix },
    body: ensureWorkItemKnowledgeRegion(withHeading)
  };
}
