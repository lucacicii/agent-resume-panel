export interface NoteFrontmatter {
  id?: string;
  scope?: "library" | "session" | "project";
  projectPath?: string;
  provider?: string;
  sessionId?: string;
  createdAt?: string;
  /** Work-item marker. Only notes with this flag appear on the work-item board. */
  work?: boolean;
  /** Concrete next action for the work item. */
  next?: string;
  /** Decision the user still owes for this work item. */
  decision?: string;
  /** Catalog session keys (`provider:id`) this work item is implemented through. */
  sessions?: string[];
  /** Project paths this work item references (0..n). Projects are referenced, never owned. */
  projects?: string[];
  /** Project a new session defaults to; only a convenience, not ownership. */
  primaryProject?: string;
}

export interface NoteWorkFields {
  next?: string;
  decision?: string;
  sessions?: string[];
  projects?: string[];
  primaryProject?: string;
}

/** Work-item fields from parsed front-matter, or `null` when the note is not a work item. */
export function workFieldsFromFrontmatter(fm: NoteFrontmatter): NoteWorkFields | null {
  if (!fm.work) return null;
  const out: NoteWorkFields = {};
  if (fm.next) out.next = fm.next;
  if (fm.decision) out.decision = fm.decision;
  if (fm.sessions && fm.sessions.length > 0) out.sessions = fm.sessions;
  if (fm.projects && fm.projects.length > 0) out.projects = fm.projects;
  if (fm.primaryProject) out.primaryProject = fm.primaryProject;
  return out;
}

export interface ParsedNoteDocument {
  frontmatter: NoteFrontmatter;
  body: string;
  raw: string;
}

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

export function parseNoteDocument(raw: string): ParsedNoteDocument {
  const match = FM_RE.exec(raw);
  if (!match) {
    return { frontmatter: {}, body: raw, raw };
  }
  return {
    frontmatter: parseSimpleYaml(match[1]),
    body: match[2],
    raw
  };
}

export function buildNoteDocument(frontmatter: NoteFrontmatter, body: string): string {
  const lines: string[] = ["---"];
  if (frontmatter.id) {
    lines.push(`id: ${frontmatter.id}`);
  }
  if (frontmatter.scope) {
    lines.push(`scope: ${frontmatter.scope}`);
  }
  if (frontmatter.projectPath) {
    lines.push(`projectPath: ${jsonish(frontmatter.projectPath)}`);
  }
  if (frontmatter.provider) {
    lines.push(`provider: ${frontmatter.provider}`);
  }
  if (frontmatter.sessionId) {
    lines.push(`sessionId: ${jsonish(frontmatter.sessionId)}`);
  }
  if (frontmatter.createdAt) {
    lines.push(`createdAt: ${frontmatter.createdAt}`);
  }
  if (frontmatter.work) {
    lines.push("work: true");
  }
  if (frontmatter.next) {
    lines.push(`next: ${jsonish(frontmatter.next)}`);
  }
  if (frontmatter.decision) {
    lines.push(`decision: ${jsonish(frontmatter.decision)}`);
  }
  if (frontmatter.sessions && frontmatter.sessions.length > 0) {
    lines.push(`sessions: ${frontmatter.sessions.join(", ")}`);
  }
  if (frontmatter.projects && frontmatter.projects.length > 0) {
    lines.push(`projects: ${frontmatter.projects.join(", ")}`);
  }
  if (frontmatter.primaryProject) {
    lines.push(`primaryProject: ${jsonish(frontmatter.primaryProject)}`);
  }
  lines.push("---", "");
  const normalizedBody = body.replace(/^\uFEFF/, "");
  return lines.join("\n") + normalizedBody.replace(/^\n+/, "");
}

export function extractTitle(body: string): string | undefined {
  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const heading = /^#\s+(.+)$/.exec(trimmed);
    if (heading) {
      return heading[1].trim();
    }
    return trimmed.slice(0, 120);
  }
  return undefined;
}

export function contentPreview(body: string, maxLen = 240): string {
  const collapsed = body.replace(/\s+/g, " ").trim();
  if (collapsed.length <= maxLen) {
    return collapsed;
  }
  return collapsed.slice(0, maxLen);
}

function parseSimpleYaml(text: string): NoteFrontmatter {
  const fm: NoteFrontmatter = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const idx = trimmed.indexOf(":");
    if (idx <= 0) {
      continue;
    }
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    switch (key) {
      case "id":
        fm.id = value;
        break;
      case "scope":
        if (value === "library" || value === "session" || value === "project") {
          fm.scope = value;
        }
        break;
      case "projectPath":
        fm.projectPath = value;
        break;
      case "provider":
        fm.provider = value;
        break;
      case "sessionId":
        fm.sessionId = value;
        break;
      case "createdAt":
        fm.createdAt = value;
        break;
      case "work":
        fm.work = value === "true" || value === "1" || value === "yes";
        break;
      case "next":
        fm.next = value;
        break;
      case "decision":
        fm.decision = value;
        break;
      case "sessions":
        fm.sessions = value.split(",").map((entry) => entry.trim()).filter(Boolean);
        break;
      case "projects":
        fm.projects = value.split(",").map((entry) => unquote(entry.trim())).filter(Boolean);
        break;
      case "primaryProject":
        fm.primaryProject = unquote(value);
        break;
      default:
        break;
    }
  }
  return fm;
}

function jsonish(value: string): string {
  if (/^[\w./@+-]+$/.test(value) && !value.includes(":")) {
    return value;
  }
  return JSON.stringify(value);
}

function unquote(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}