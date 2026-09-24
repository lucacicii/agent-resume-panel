/**
 * Agent roles.
 *
 * A role is *configuration*: a persona plus a capability tier. The Rust host
 * (`thunder-agent-root`) is the authority that enforces `permission`; this
 * module only reads the same JSONL so the panel can offer roles in a slash
 * palette and render their state.
 *
 * Storage: one JSON object per line.
 *   ~/.thunder/roles.jsonl        global
 *   <project>/.arp/roles.jsonl    project scope (same `id` overrides global)
 */

/**
 * Capability tier, mirroring `thunder_agent_loop::types::config::Permission`.
 *
 * Progression: `read` ⊂ `write` ⊂ `bash`.
 */
export type RolePermission = "read" | "write" | "bash";

/** Persona body: a single string, or an array of lines joined with `\n`. */
export type RolePersona = string | string[];

/** Raw record as authored in JSONL. All optional except `id`. */
export interface RoleRecord {
  id: string;
  name?: string;
  aliases?: string[];
  description?: string;
  persona?: RolePersona;
  permission?: RolePermission;
  model?: string;
  thinkingLevel?: string;
  /** snake_case alias accepted for hand-written files. */
  thinking_level?: string;
  askUser?: boolean;
  ask_user?: boolean;
  exitGate?: boolean;
  exit_gate?: boolean;
  enabled?: boolean;
  triggers?: string[];
}

/** Normalized role, with defaults applied. */
export interface ProjectRoleDescriptor {
  id: string;
  name: string;
  aliases: string[];
  description?: string;
  /** Persona body, already flattened to text. */
  persona: string;
  permission: RolePermission;
  model?: string;
  thinkingLevel?: string;
  /** Whether `ask_user_question` is mounted for this role. */
  askUser: boolean;
  /** Whether leaving the role requires explicit approval. */
  exitGate: boolean;
  enabled: boolean;
  triggers: string[];
  /** File this role came from (for reload/debug surfaces). */
  filePath: string;
  fileName: string;
  updatedAtMs?: number;
}

export interface DiscoverRolesOptions {
  projectPath?: string | null;
  /** Overrides `~/.thunder`; primarily for tests. */
  thunderHome?: string | null;
  /** Overrides `$HOME`; primarily for tests. */
  userHome?: string | null;
}

/** @deprecated Retained for compatibility; roles are host-enforced, not per-agent. */
export type ProjectRoleAgent = "pi" | "claude" | "codex";

/** @deprecated Use `RolePermission`; kept so older imports keep compiling. */
export type ProjectRolePermission = "read" | "write";

/** @deprecated Use `RolePermission`; roles no longer carry an orthogonal tool matrix. */
export interface ProjectRoleTools {
  fsRead: boolean;
  fsWrite: boolean;
  execute: boolean;
}

/** @deprecated Use `DiscoverRolesOptions`. */
export type DiscoverProjectRolesOptions = DiscoverRolesOptions;

/** Capability summary shared by UI labels and prompts. */
export const ROLE_PERMISSION_LABELS: Record<RolePermission, string> = {
  read: "Read-only",
  write: "Read + write",
  bash: "Full (bash)"
};

/** Whether a tier permits filesystem writes. */
export function roleAllowsWrite(permission: RolePermission): boolean {
  return permission === "write" || permission === "bash";
}

/** Whether a tier permits shell execution. */
export function roleAllowsExec(permission: RolePermission): boolean {
  return permission === "bash";
}
