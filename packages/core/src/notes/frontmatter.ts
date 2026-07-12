export interface NoteFrontmatter {
  id?: string;
  scope?: "library" | "session" | "project";
  projectPath?: string;
  provider?: string;
  sessionId?: string;
  createdAt?: string;
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