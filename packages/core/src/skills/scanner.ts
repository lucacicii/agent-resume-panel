import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { DiscoverSkillsOptions, SkillDescriptor, SkillScope } from "./types";

/**
 * Extract frontmatter fields from Markdown content.
 * Supports simple YAML-like key: value syntax without heavy external YAML parsers.
 */
export function parseSkillFrontmatter(content: string): {
  name?: string;
  description?: string;
  triggers?: string[];
  rawBody: string;
} {
  const trimmed = content.trim();
  if (!trimmed.startsWith("---")) {
    return { rawBody: content };
  }

  const endIdx = trimmed.indexOf("\n---", 3);
  if (endIdx === -1) {
    return { rawBody: content };
  }

  const frontmatterStr = trimmed.slice(3, endIdx).trim();
  const rawBody = trimmed.slice(endIdx + 4).trim();

  let name: string | undefined;
  let description: string | undefined;
  const triggers: string[] = [];

  const lines = frontmatterStr.split(/\r?\n/);
  let currentKey = "";
  let currentValue = "";

  const commitField = () => {
    if (!currentKey) return;
    const cleanKey = currentKey.trim().toLowerCase();
    const cleanVal = currentValue.trim();
    if (cleanKey === "name") {
      name = cleanVal.replace(/^["']|["']$/g, "");
    } else if (cleanKey === "description") {
      description = cleanVal.replace(/^["']|["']$/g, "");
    } else if (cleanKey === "trigger" || cleanKey === "triggers") {
      if (cleanVal) {
        triggers.push(cleanVal.replace(/^["']|["']$/g, ""));
      }
    }
    currentKey = "";
    currentValue = "";
  };

  for (const line of lines) {
    const match = line.match(/^([a-zA-Z0-9_-]+)\s*:\s*(.*)$/);
    if (match) {
      commitField();
      currentKey = match[1] ?? "";
      currentValue = match[2] ?? "";
    } else if (currentKey && (line.startsWith("  ") || line.startsWith("\t"))) {
      // Continuation of multiline string / list item
      const itemMatch = line.trim().match(/^-\s*(.*)$/);
      if (itemMatch && (currentKey.toLowerCase() === "triggers" || currentKey.toLowerCase() === "trigger")) {
        triggers.push(itemMatch[1]!.replace(/^["']|["']$/g, ""));
      } else {
        currentValue += (currentValue ? "\n" : "") + line.trim();
      }
    }
  }
  commitField();

  return { name, description, triggers: triggers.length ? triggers : undefined, rawBody };
}

/**
 * Fallback parser when YAML frontmatter is missing.
 * Extracts skill name from the first `# Header` and description from following paragraphs.
 */
export function parseSkillMarkdownFallback(content: string, fallbackName: string): {
  name: string;
  description: string;
  triggers?: string[];
} {
  const lines = content.split(/\r?\n/);
  let name = fallbackName;
  let description = "";
  const triggers: string[] = [];

  let foundTitle = false;
  const descLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (!foundTitle && trimmed.startsWith("#")) {
      name = trimmed.replace(/^#+\s*/, "").trim();
      foundTitle = true;
      continue;
    }

    if (/^(TRIGGER|TRIGGERS|WHEN TO USE|触发条件)(?:\s+WHEN)?\s*[:：]/i.test(trimmed)) {
      triggers.push(trimmed.replace(/^(TRIGGER|TRIGGERS|WHEN TO USE|触发条件)(?:\s+WHEN)?\s*[:：]\s*/i, "").trim());
      continue;
    }

    if (descLines.length < 5) {
      descLines.push(trimmed);
    }
  }

  description = descLines.join(" ").slice(0, 500);
  return { name: name || fallbackName, description, triggers: triggers.length ? triggers : undefined };
}

/**
 * Parse a single SKILL.md file into a SkillDescriptor.
 */
export async function parseSkillFile(
  skillMdPath: string,
  scope: SkillScope,
  loadContent = false
): Promise<SkillDescriptor | null> {
  try {
    const raw = await fs.readFile(skillMdPath, "utf-8");
    const dir = path.dirname(skillMdPath);
    const dirName = path.basename(dir);

    const { name: fmName, description: fmDesc, triggers: fmTriggers, rawBody } = parseSkillFrontmatter(raw);
    let name = fmName;
    let description = fmDesc;
    let triggers = fmTriggers;

    if (!name || !description) {
      const fallback = parseSkillMarkdownFallback(rawBody || raw, dirName);
      if (!name) name = fallback.name;
      if (!description) description = fallback.description;
      if (!triggers && fallback.triggers) triggers = fallback.triggers;
    }

    return {
      name: name || dirName,
      description: description || name || dirName,
      location: path.resolve(skillMdPath),
      directory: path.resolve(dir),
      scope,
      triggers,
      content: loadContent ? raw : undefined
    };
  } catch {
    return null;
  }
}

/**
 * Scan a directory for subdirectories containing SKILL.md or skill.md.
 */
async function scanSkillsDir(baseDir: string, scope: SkillScope, loadContent: boolean): Promise<SkillDescriptor[]> {
  const results: SkillDescriptor[] = [];
  try {
    const entries = await fs.readdir(baseDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const subDir = path.join(baseDir, entry.name);
        const candidates = [
          path.join(subDir, "SKILL.md"),
          path.join(subDir, "skill.md")
        ];
        for (const candidate of candidates) {
          try {
            const stat = await fs.stat(candidate);
            if (stat.isFile()) {
              const parsed = await parseSkillFile(candidate, scope, loadContent);
              if (parsed) results.push(parsed);
              break;
            }
          } catch {
            // File does not exist, continue
          }
        }
      }
    }
  } catch {
    // Directory might not exist
  }
  return results;
}

/**
 * Scan nested package skills like ~/.pi/agent/npm/node_modules/
 */
async function scanPackageSkills(npmBaseDir: string, loadContent: boolean): Promise<SkillDescriptor[]> {
  const results: SkillDescriptor[] = [];
  try {
    const packages = await fs.readdir(npmBaseDir, { withFileTypes: true });
    for (const pkg of packages) {
      if (pkg.isDirectory()) {
        const skillsDir = path.join(npmBaseDir, pkg.name, "skills");
        const scanned = await scanSkillsDir(skillsDir, "package", loadContent);
        results.push(...scanned);
      }
    }
  } catch {
    // Directory might not exist
  }
  return results;
}

/**
 * Discover all available skills across standard user, project, pi, and package paths.
 */
export async function discoverSkills(options: DiscoverSkillsOptions = {}): Promise<SkillDescriptor[]> {
  const home = options.userHome || os.homedir();
  const loadContent = Boolean(options.loadContent);

  const searchRoots: Array<{ dir: string; scope: SkillScope; isNpm?: boolean }> = [];

  // Project-level skill directories (highest priority)
  if (options.projectPath) {
    searchRoots.push(
      { dir: path.join(options.projectPath, ".agents", "skills"), scope: "project" },
      { dir: path.join(options.projectPath, ".pi", "skills"), scope: "project" },
      { dir: path.join(options.projectPath, "skills"), scope: "project" }
    );
  }

  // Global user skill directories
  searchRoots.push(
    { dir: path.join(home, ".agents", "skills"), scope: "user" },
    { dir: path.join(home, ".pi", "agent", "skills"), scope: "pi" },
    { dir: path.join(home, ".pi", "skills"), scope: "pi" },
    { dir: path.join(home, ".pi", "agent", "npm", "node_modules"), scope: "package", isNpm: true }
  );

  // Extra search paths if provided
  if (options.extraSkillPaths?.length) {
    for (const extra of options.extraSkillPaths) {
      searchRoots.push({ dir: extra, scope: "user" });
    }
  }

  const allSkills: SkillDescriptor[] = [];

  for (const root of searchRoots) {
    if (root.isNpm) {
      const pkgSkills = await scanPackageSkills(root.dir, loadContent);
      allSkills.push(...pkgSkills);
    } else {
      const skills = await scanSkillsDir(root.dir, root.scope, loadContent);
      allSkills.push(...skills);
    }
  }

  // Deduplicate by skill name (project scope beats user, which beats pi/package)
  const priorityOrder: Record<SkillScope, number> = {
    project: 4,
    user: 3,
    pi: 2,
    package: 1
  };

  const skillMap = new Map<string, SkillDescriptor>();
  for (const skill of allSkills) {
    const existing = skillMap.get(skill.name);
    if (!existing || priorityOrder[skill.scope] > priorityOrder[existing.scope]) {
      skillMap.set(skill.name, skill);
    }
  }

  return Array.from(skillMap.values()).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Read the full content of a SKILL.md file.
 */
export async function readSkillContent(location: string): Promise<string> {
  return fs.readFile(location, "utf-8");
}

/**
 * Format a list of skills into an XML prompt block (<available_skills>...</available_skills>)
 * suitable for system prompt injection in ACP sessions and Conductor dispatches.
 */
export function formatSkillsCatalogPrompt(skills: SkillDescriptor[]): string {
  if (!skills.length) return "";

  const entries = skills.map((skill) => {
    const triggerPart = skill.triggers?.length ? `\nTriggers: ${skill.triggers.join(", ")}` : "";
    const desc = `${skill.description}${triggerPart}`.trim();
    return `  <skill>
    <name>${skill.name}</name>
    <description>${escapeXml(desc)}</description>
    <location>${escapeXml(skill.location)}</location>
  </skill>`;
  });

  return `<available_skills>
${entries.join("\n")}
</available_skills>`;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
