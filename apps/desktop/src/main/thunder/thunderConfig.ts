import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type {
  ThunderModelsConfig,
  ThunderRoleRecord
} from "@agent-resume/core";

/**
 * Direct read/write access to Thunder's own config files
 * (`~/.thunder/models.json`, `~/.thunder/roles.jsonl`).
 *
 * The daemon reloads both files per request, so edits here take effect on the
 * very next `run_task` / `list_roles` — no daemon restart involved. That is
 * why this lives beside the client rather than inside any RPC: the file is
 * the source of truth, the RPCs are just views of it.
 *
 * The store's directory is injectable so unit tests can run against a
 * tempdir instead of the user's real `~/.thunder`.
 */

export interface ThunderConfigStore {
  /** Append any built-in role whose id is absent. Never touches existing lines. */
  ensureBuiltinRoles(): { ensured: string[] };
  readRolesFile(): ThunderRoleRecord[];
  writeRolesFile(records: ThunderRoleRecord[]): void;
  resetBuiltinRole(id: string): void;
  readModelsConfig(): ThunderModelsConfig;
  writeModelsConfig(config: ThunderModelsConfig): void;
}

/**
 * The roles the app ships with. `ensureBuiltinRoles` appends any whose id is
 * absent — it never overwrites a user's edited definition of the same id, so
 * "built-in" means bundled-by-default, not immutable. The UI marks these and
 * disables deletion; `resetBuiltinRole` restores the shipped definition.
 *
 * Keep field semantics in sync with thunder's `RoleSpec`
 * (thunder-agent-root/src/roles.rs): permission = capability tier,
 * mode = approval policy, triggers = keyword auto-selection.
 */
export const BUILT_IN_ROLES: ReadonlyArray<Record<string, unknown>> = [
  {
    id: "plan",
    name: "Plan",
    aliases: ["p"],
    description: "Plan before acting. Read-only: no file writes, no shell.",
    persona: [
      "You are a planning-only engineering assistant.",
      "",
      "Rules:",
      "1. Output a complete plan BEFORE any code change is discussed as done.",
      "2. Never modify files and never run shell commands — you have no such tools.",
      "3. When a decision materially changes the outcome, call ask_user_question instead of guessing.",
      "4. The plan must state: current-state facts, exact files to touch, risks, and how to verify."
    ],
    permission: "read",
    mode: "plan",
    askUser: true,
    exitGate: true,
    enabled: true
  },
  {
    id: "architect",
    name: "Architect",
    aliases: ["arch", "a"],
    description:
      "System design: evaluates trade-offs, writes ADRs and design docs, defines module boundaries. Can write files, no shell.",
    persona: [
      "You are a software architect. You own design decisions and their documentation, not implementation.",
      "",
      "Rules:",
      "1. Before proposing a design, read the relevant code until you can state the current architecture precisely — no designing from assumptions.",
      "2. Always compare at least two candidate approaches: trade-offs, migration cost, blast radius.",
      "3. Deliverables are design docs / ADRs written as files: context, options considered, decision + rationale, consequences, rollout plan.",
      "4. Define module boundaries and interface contracts (types, APIs, error semantics) precisely enough that an implementer can code without asking you.",
      "5. When requirements are ambiguous or a decision materially changes cost or risk, call ask_user_question instead of guessing.",
      "6. You have no shell: do not claim a design is verified by building or running it."
    ],
    permission: "write",
    mode: "accept_edits",
    askUser: true,
    exitGate: false,
    enabled: true,
    triggers: ["架构", "architecture", "设计", "design", "技术方案", "ADR"]
  },
  {
    id: "pm",
    name: "Project Manager",
    aliases: ["manager", "m"],
    description:
      "Task breakdown, milestones, priorities and risk tracking. Read-only: reports and plans go into the conversation.",
    persona: [
      "You are a project manager for engineering work. You turn goals into executable, tracked plans.",
      "",
      "Rules:",
      "1. Ground every status report in repository facts you have actually read — code, docs, TODOs. No invented progress.",
      "2. Deliverables: task breakdown (owner, estimate, dependencies), milestone plan, risk register with mitigations.",
      "3. Keep tasks small and verifiable; each task states a definition of done and how to verify it.",
      "4. Surface blockers and scope creep immediately; when priorities conflict, call ask_user_question with concrete options.",
      "5. Never modify files and never run shell commands — you have no such tools. Plans and reports go into the conversation."
    ],
    permission: "read",
    mode: "plan",
    askUser: true,
    exitGate: true,
    enabled: true,
    triggers: ["项目管理", "排期", "任务拆解", "进度", "milestone", "sprint"]
  }
];

export const BUILT_IN_ROLE_IDS: ReadonlySet<string> = new Set(
  BUILT_IN_ROLES.map((role) => String(role.id))
);

function parseRolesLines(text: string): Array<Record<string, unknown> | null> {
  // Mirrors thunder's reader: one JSON object per line, malformed lines
  // skipped so a partial write never loses the whole registry.
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      try {
        const value = JSON.parse(line) as unknown;
        return value && typeof value === "object" && !Array.isArray(value)
          ? (value as Record<string, unknown>)
          : null;
      } catch {
        return null;
      }
    });
}

/** Write with a `.bak` of the previous file and an atomic rename. */
function atomicWrite(file: string, contents: string): void {
  try {
    fs.copyFileSync(file, `${file}.bak`);
  } catch {
    // No previous file to back up.
  }
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, contents, "utf8");
  fs.renameSync(tmp, file);
}

export function createThunderConfigStore(dir?: string): ThunderConfigStore {
  const base = dir ?? path.join(os.homedir(), ".thunder");
  const rolesPath = path.join(base, "roles.jsonl");
  const modelsPath = path.join(base, "models.json");

  return {
    ensureBuiltinRoles(): { ensured: string[] } {
      const ensured: string[] = [];
      try {
        fs.mkdirSync(base, { recursive: true });
        let text = "";
        try {
          text = fs.readFileSync(rolesPath, "utf8");
        } catch {
          text = "";
        }
        const existing = new Set(
          parseRolesLines(text)
            .filter((line): line is Record<string, unknown> => line !== null)
            .map((line) => String(line.id ?? ""))
            .filter((id) => id.length > 0)
        );
        const additions: string[] = [];
        for (const role of BUILT_IN_ROLES) {
          const id = String(role.id);
          if (!existing.has(id)) {
            additions.push(JSON.stringify(role));
            ensured.push(id);
          }
        }
        if (additions.length > 0) {
          const prefix = text.length > 0 && !text.endsWith("\n") ? "\n" : "";
          fs.writeFileSync(rolesPath, `${text}${prefix}${additions.join("\n")}\n`, "utf8");
        }
      } catch (err) {
        console.warn("[thunder-config] Failed to ensure built-in roles:", err);
      }
      return { ensured };
    },

    readRolesFile(): ThunderRoleRecord[] {
      let text = "";
      try {
        text = fs.readFileSync(rolesPath, "utf8");
      } catch {
        return [];
      }
      return parseRolesLines(text)
        .filter((line): line is Record<string, unknown> => line !== null)
        .map((raw) => ({
          raw,
          builtin: BUILT_IN_ROLE_IDS.has(String(raw.id ?? ""))
        }));
    },

    writeRolesFile(records: ThunderRoleRecord[]): void {
      const seen = new Set<string>();
      const lines: string[] = [];
      for (const record of records) {
        const id = String(record.raw?.id ?? "").trim();
        if (!id) {
          throw new Error("Every role needs a non-empty id");
        }
        if (seen.has(id)) {
          throw new Error(`Duplicate role id: ${id}`);
        }
        seen.add(id);
        lines.push(JSON.stringify(record.raw));
      }
      fs.mkdirSync(base, { recursive: true });
      atomicWrite(rolesPath, lines.length > 0 ? `${lines.join("\n")}\n` : "");
    },

    resetBuiltinRole(id: string): void {
      const builtin = BUILT_IN_ROLES.find((role) => String(role.id) === id);
      if (!builtin) {
        throw new Error(`Not a built-in role: ${id}`);
      }
      const records = this.readRolesFile();
      const index = records.findIndex((record) => String(record.raw.id) === id);
      const replacement: ThunderRoleRecord = { raw: { ...builtin }, builtin: true };
      if (index >= 0) {
        records[index] = replacement;
      } else {
        records.push(replacement);
      }
      this.writeRolesFile(records);
    },

    readModelsConfig(): ThunderModelsConfig {
      const text = fs.readFileSync(modelsPath, "utf8");
      const value = JSON.parse(text) as unknown;
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("models.json: expected a top-level object");
      }
      const record = value as Record<string, unknown>;
      if (
        record.providers !== undefined &&
        (typeof record.providers !== "object" || Array.isArray(record.providers))
      ) {
        throw new Error("models.json: `providers` must be an object keyed by provider id");
      }
      return {
        providers: (record.providers as ThunderModelsConfig["providers"]) ?? {},
        utilityModel:
          typeof record.utilityModel === "string" ? record.utilityModel : undefined
      };
    },

    writeModelsConfig(config: ThunderModelsConfig): void {
      if (!config || typeof config !== "object" || Array.isArray(config)) {
        throw new Error("models config: expected an object");
      }
      if (
        !config.providers ||
        typeof config.providers !== "object" ||
        Array.isArray(config.providers)
      ) {
        throw new Error("models config: `providers` must be an object keyed by provider id");
      }
      for (const [id, provider] of Object.entries(config.providers)) {
        if (!id.trim()) {
          throw new Error("Provider id cannot be empty");
        }
        if (
          provider &&
          typeof provider === "object" &&
          typeof provider.apiKey === "string" &&
          !provider.apiKey.trim()
        ) {
          throw new Error(
            `Provider "${id}": apiKey cannot be empty (remove the provider instead)`
          );
        }
      }
      const payload: Record<string, unknown> = { providers: config.providers };
      if (config.utilityModel) payload.utilityModel = config.utilityModel;
      fs.mkdirSync(base, { recursive: true });
      atomicWrite(modelsPath, `${JSON.stringify(payload, null, 2)}\n`);
    }
  };
}

/** The user's real `~/.thunder` store. */
export const thunderConfigStore = createThunderConfigStore();

export const thunderConfigPaths = {
  dir: () => path.join(os.homedir(), ".thunder"),
  roles: () => path.join(os.homedir(), ".thunder", "roles.jsonl"),
  models: () => path.join(os.homedir(), ".thunder", "models.json")
};
