import * as fs from "node:fs/promises";
import * as path from "node:path";
import type {
  DiscoverProjectRolesOptions,
  ProjectRoleAgent,
  ProjectRoleDescriptor,
  ProjectRolePermission,
  ProjectRoleTools
} from "./types";

const VALID_AGENTS: ReadonlySet<string> = new Set(["pi", "claude", "codex"]);

function parseBoolean(value: unknown, defaultValue = false): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const s = value.trim().toLowerCase();
    if (s === "true" || s === "1" || s === "yes" || s === "on") return true;
    if (s === "false" || s === "0" || s === "no" || s === "off") return false;
  }
  return defaultValue;
}

function parseAgent(value: unknown, defaultValue: ProjectRoleAgent = "claude"): ProjectRoleAgent {
  if (typeof value === "string") {
    const s = value.trim().toLowerCase();
    if (VALID_AGENTS.has(s)) return s as ProjectRoleAgent;
  }
  return defaultValue;
}

function parsePermission(value: unknown, tools: ProjectRoleTools): ProjectRolePermission {
  if (typeof value === "string") {
    const s = value.trim().toLowerCase();
    if (s === "write" || s === "read") return s;
  }
  return tools.fsWrite ? "write" : "read";
}

function slugToName(slug: string): string {
  return slug
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .trim() || "Custom Role";
}

/**
 * Extract YAML-like frontmatter and Markdown body from a role file.
 */
export function parseRoleMarkdown(
  content: string,
  options?: { filePath?: string; fileName?: string; fallbackSlug?: string }
): Omit<ProjectRoleDescriptor, "id" | "filePath" | "fileName" | "updatedAtMs"> & {
  slug: string;
} {
  const fileName = options?.fileName || (options?.filePath ? path.basename(options.filePath) : "");
  const baseSlug = (options?.fallbackSlug || fileName.replace(/\.[^/.]+$/, "") || "custom-role")
    .toLowerCase()
    .replace(/_/g, "-")
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "custom-role";

  const trimmed = content.trim();
  let frontmatterStr = "";
  let rawBody = trimmed;

  if (trimmed.startsWith("---")) {
    const endIdx = trimmed.indexOf("\n---", 3);
    if (endIdx !== -1) {
      frontmatterStr = trimmed.slice(3, endIdx).trim();
      rawBody = trimmed.slice(endIdx + 4).trim();
    }
  }

  let name: string | undefined;
  let agentRaw: string | undefined;
  let model: string | undefined;
  let thoughtLevel: string | undefined;
  let permissionsRaw: string | undefined;
  const toolsRaw: { fsWrite?: boolean; execute?: boolean } = {};
  const callable: string[] = [];
  let autoDispatch = false;
  let enabled = true;

  if (frontmatterStr) {
    const lines = frontmatterStr.split(/\r?\n/);
    let currentKey = "";
    let inCallableList = false;
    let inToolsBlock = false;

    for (const rawLine of lines) {
      const line = rawLine.replace(/#.*$/, ""); // strip inline comments
      const trimmedLine = line.trim();
      if (!trimmedLine) continue;

      const isIndented = rawLine.startsWith("  ") || rawLine.startsWith("\t");

      if (isIndented && inCallableList) {
        const itemMatch = trimmedLine.match(/^-\s*(.*)$/);
        if (itemMatch) {
          const itemVal = itemMatch[1]!.trim().replace(/^["']|["']$/g, "");
          if (itemVal) callable.push(itemVal);
          continue;
        }
      }

      if (isIndented && inToolsBlock) {
        const toolMatch = trimmedLine.match(/^([a-zA-Z0-9_-]+)\s*:\s*(.*)$/);
        if (toolMatch) {
          const k = toolMatch[1]!.toLowerCase();
          const v = toolMatch[2]!.trim();
          if (k === "fswrite" || k === "fs_write" || k === "write") {
            toolsRaw.fsWrite = parseBoolean(v, false);
          } else if (k === "execute" || k === "exec") {
            toolsRaw.execute = parseBoolean(v, false);
          }
          continue;
        }
      }

      const match = trimmedLine.match(/^([a-zA-Z0-9_.-]+)\s*:\s*(.*)$/);
      if (match) {
        currentKey = match[1]!.toLowerCase();
        const value = match[2]!.trim().replace(/^["']|["']$/g, "");
        inCallableList = false;
        inToolsBlock = false;

        switch (currentKey) {
          case "name":
            name = value;
            break;
          case "agent":
            agentRaw = value;
            break;
          case "model":
            model = value || undefined;
            break;
          case "thoughtlevel":
          case "thought_level":
            thoughtLevel = value || undefined;
            break;
          case "permission":
          case "permissions":
            permissionsRaw = value;
            break;
          case "autodispatch":
          case "auto_dispatch":
            autoDispatch = parseBoolean(value, false);
            break;
          case "enabled":
            enabled = parseBoolean(value, true);
            break;
          case "tools":
            inToolsBlock = true;
            break;
          case "callable":
          case "callables":
          case "callable_template_ids":
            if (value.startsWith("[") && value.endsWith("]")) {
              const arrayItems = value
                .slice(1, -1)
                .split(",")
                .map((s) => s.trim().replace(/^["']|["']$/g, ""))
                .filter(Boolean);
              callable.push(...arrayItems);
            } else if (value) {
              callable.push(value);
            } else {
              inCallableList = true;
            }
            break;
          case "tools.fswrite":
          case "tools.fs_write":
            toolsRaw.fsWrite = parseBoolean(value, false);
            break;
          case "tools.execute":
          case "tools.exec":
            toolsRaw.execute = parseBoolean(value, false);
            break;
        }
      }
    }
  }

  // Fallbacks
  const finalTools: ProjectRoleTools = {
    fsRead: true,
    fsWrite: toolsRaw.fsWrite ?? (permissionsRaw === "write"),
    execute: toolsRaw.execute ?? false
  };

  const finalName = name || slugToName(baseSlug);
  const finalAgent = parseAgent(agentRaw, "claude");
  const finalPermissions = parsePermission(permissionsRaw, finalTools);
  const finalPersona = rawBody || `You are ${finalName} for this project.`;

  return {
    slug: baseSlug,
    name: finalName,
    persona: finalPersona,
    agent: finalAgent,
    model: model || undefined,
    thoughtLevel: thoughtLevel || undefined,
    permissions: finalPermissions,
    tools: finalTools,
    callable: [...new Set(callable)],
    autoDispatch,
    enabled
  };
}

/**
 * Scan <projectPath>/.arp/roles/*.md and return all discovered project-scoped roles.
 */
export async function discoverProjectRoles(
  options: DiscoverProjectRolesOptions = {}
): Promise<ProjectRoleDescriptor[]> {
  const { projectPath } = options;
  if (!projectPath) return [];

  const rolesDir = path.join(projectPath, ".arp", "roles");
  let entries: Array<{ name: string; isFile: () => boolean }>;
  try {
    const dirList = await fs.readdir(rolesDir, { withFileTypes: true });
    entries = dirList;
  } catch {
    return [];
  }

  const mdFiles = entries.filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".md"));
  const results: ProjectRoleDescriptor[] = [];

  for (const file of mdFiles) {
    const filePath = path.join(rolesDir, file.name);
    try {
      const stats = await fs.stat(filePath);
      const content = await fs.readFile(filePath, "utf8");
      const parsed = parseRoleMarkdown(content, {
        filePath,
        fileName: file.name
      });
      const id = `project_role_${parsed.slug}`;

      results.push({
        ...parsed,
        id,
        filePath,
        fileName: file.name,
        updatedAtMs: stats.mtimeMs
      });
    } catch {
      // Ignore unreadable or corrupt file
    }
  }

  results.sort((a, b) => a.slug.localeCompare(b.slug));
  return results;
}
