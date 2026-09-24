import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { readJsonLines } from "../transcript/jsonl";
import type {
  DiscoverRolesOptions,
  ProjectRoleDescriptor,
  RolePermission,
  RolePersona,
  RoleRecord
} from "./types";

const VALID_PERMISSIONS: ReadonlySet<string> = new Set(["read", "write", "bash"]);
const DEFAULT_PERMISSION: RolePermission = "read";

/** JSONL file holding roles for one scope. */
export const ROLES_FILE_NAME = "roles.jsonl";

/**
 * Resolve `~/.thunder`, honouring `THUNDER_CONFIG_DIR` exactly like the Rust
 * host (`thunder-agent-root::roles::RoleRegistry::thunder_home`).
 */
export function resolveThunderHome(
  options: { thunderHome?: string | null; userHome?: string | null } = {}
): string {
  const explicit = options.thunderHome?.trim();
  if (explicit) return explicit;

  const fromEnv = process.env.THUNDER_CONFIG_DIR?.trim();
  if (fromEnv) return fromEnv;

  const home = options.userHome?.trim() || process.env.HOME || os.homedir();
  return path.join(home, ".thunder");
}

/** Flatten a persona (string or string[]) to text. */
export function personaToText(persona: RolePersona | undefined): string {
  if (typeof persona === "string") return persona;
  if (Array.isArray(persona)) return persona.join("\n");
  return "";
}

function parsePermission(value: unknown): RolePermission {
  if (typeof value === "string" && VALID_PERMISSIONS.has(value.trim().toLowerCase())) {
    return value.trim().toLowerCase() as RolePermission;
  }
  return DEFAULT_PERMISSION;
}

function parseBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const s = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(s)) return true;
    if (["false", "0", "no", "off"].includes(s)) return false;
  }
  return fallback;
}

function parseStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === "string").map((v) => v.trim()).filter(Boolean);
  }
  if (typeof value === "string" && value.trim()) {
    return [value.trim()];
  }
  return [];
}

/**
 * Normalize one JSONL record. Returns `null` when the record has no usable id,
 * so a partially written line never breaks the whole palette.
 *
 * Unknown fields are ignored on purpose: the panel should tolerate a role file
 * authored for a newer host rather than reject it.
 */
export function normalizeRoleRecord(
  record: unknown,
  source: { filePath: string; fileName: string; updatedAtMs?: number }
): ProjectRoleDescriptor | null {
  if (!record || typeof record !== "object") return null;
  const raw = record as RoleRecord;

  const id = typeof raw.id === "string" ? raw.id.trim() : "";
  if (!id) return null;

  const persona = personaToText(raw.persona);

  return {
    id,
    name: typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : id,
    aliases: parseStringArray(raw.aliases),
    description: typeof raw.description === "string" && raw.description.trim() ? raw.description.trim() : undefined,
    persona,
    permission: parsePermission(raw.permission),
    model: typeof raw.model === "string" && raw.model.trim() ? raw.model.trim() : undefined,
    thinkingLevel: (() => {
      const tl = raw.thinkingLevel ?? raw.thinking_level;
      return typeof tl === "string" && tl.trim() ? tl.trim() : undefined;
    })(),
    askUser: parseBoolean(raw.askUser ?? raw.ask_user, false),
    exitGate: parseBoolean(raw.exitGate ?? raw.exit_gate, false),
    enabled: parseBoolean(raw.enabled, true),
    triggers: parseStringArray(raw.triggers),
    filePath: source.filePath,
    fileName: source.fileName,
    updatedAtMs: source.updatedAtMs
  };
}

/**
 * Read one `roles.jsonl`. Missing files yield `[]`; malformed lines are skipped
 * (the file is append-friendly, so a partial trailing write is expected).
 */
export async function readRolesFile(
  filePath: string
): Promise<ProjectRoleDescriptor[]> {
  let updatedAtMs: number | undefined;
  try {
    const stats = await fs.stat(filePath);
    updatedAtMs = stats.mtimeMs;
  } catch {
    return [];
  }

  const rows = await readJsonLines<unknown>(filePath);
  const fileName = path.basename(filePath);

  const out: ProjectRoleDescriptor[] = [];
  for (const row of rows) {
    const role = normalizeRoleRecord(row, { filePath, fileName, updatedAtMs });
    if (role) out.push(role);
  }
  return out;
}

/** Where a scope's roles live. */
export function rolesFilePath(scopeDir: string): string {
  return path.join(scopeDir, ROLES_FILE_NAME);
}

/**
 * Discover roles from global + project scopes.
 *
 * Scope order is global first, then project, so a project role with the same
 * `id` deterministically overrides the global one — matching the Rust host.
 * The returned array keeps that override applied and is sorted by id.
 */
export async function discoverRoles(
  options: DiscoverRolesOptions = {}
): Promise<ProjectRoleDescriptor[]> {
  const thunderHome = resolveThunderHome(options);

  const sources: string[] = [rolesFilePath(thunderHome)];
  if (options.projectPath) {
    sources.push(rolesFilePath(path.join(options.projectPath, ".arp")));
  }

  const merged = new Map<string, ProjectRoleDescriptor>();
  for (const source of sources) {
    for (const role of await readRolesFile(source)) {
      merged.set(role.id, role);
    }
  }

  const list = [...merged.values()];
  // Enabled first, then alphabetical — mirrors `RoleRegistry::list`.
  list.sort((a, b) => {
    if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
    return a.id.toLowerCase().localeCompare(b.id.toLowerCase());
  });
  return list;
}

/** Enabled roles only — what a slash palette should offer. */
export async function discoverEnabledRoles(
  options: DiscoverRolesOptions = {}
): Promise<ProjectRoleDescriptor[]> {
  return (await discoverRoles(options)).filter((role) => role.enabled);
}

/** Resolve a role by id or alias (case-insensitive, leading `/` tolerated). */
export function resolveRole(
  roles: ProjectRoleDescriptor[],
  token: string
): ProjectRoleDescriptor | undefined {
  const t = token.trim().replace(/^\//, "").toLowerCase();
  return roles.find(
    (r) => r.id.toLowerCase() === t || r.aliases.some((a) => a.toLowerCase() === t)
  );
}

/**
 * Render the prompt preamble for an active role.
 *
 * Sent to the host as context; the host independently re-resolves the role by id
 * and enforces `permission`, so this text is descriptive, never authoritative.
 */
export function renderRolePreamble(role: ProjectRoleDescriptor): string {
  const capability =
    role.permission === "read"
      ? "read-only (fs_write=off, bash=off)"
      : role.permission === "write"
        ? "read+write (fs_write=on, bash=off)"
        : "full (fs_write=on, bash=on)";

  const body = role.persona.trim() || `You are ${role.name}.`;
  return `[Active Role: ${role.name}]\npermission: ${capability}\n${body}\n[End Role]`;
}

/**
 * @deprecated Markdown roles are no longer supported; use `readRolesFile`.
 * Retained only so existing imports keep compiling.
 */
export function parseRoleMarkdown(): never {
  throw new Error(
    "parseRoleMarkdown is removed: roles are JSONL now. Use discoverRoles() / readRolesFile()."
  );
}

/**
 * @deprecated Use `discoverRoles`. Kept as an alias for older call sites.
 */
export async function discoverProjectRoles(
  options: DiscoverRolesOptions = {}
): Promise<ProjectRoleDescriptor[]> {
  return discoverRoles(options);
}
