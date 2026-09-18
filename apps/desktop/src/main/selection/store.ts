import { randomUUID } from "node:crypto";
import {
  ensureDesktopDbSchema,
  escapeSqlLiteral,
  runSqlite,
  runSqliteJson
} from "@agent-resume/core";
import {
  BUILTIN_SELECTION_ACTION_IDS,
  isBuiltinSelectionActionId,
  type SelectionAction
} from "../../shared/selectionActions";

const SELECTION_PROMPT_MAX = 4_000;
const SELECTION_TEXT_MAX = 8_000;

interface BuiltinSelectionActionSpec {
  actionId: (typeof BUILTIN_SELECTION_ACTION_IDS)[number];
  name: string;
  prompt: string;
  sortOrder: number;
}

const BUILTIN_SELECTION_ACTIONS: readonly BuiltinSelectionActionSpec[] = [
  {
    actionId: "translate",
    name: "Translate",
    prompt: "Translate the following text into the user's UI language. Return only the translation.\n\n{selection}",
    sortOrder: 0
  },
  {
    actionId: "explain",
    name: "Explain",
    prompt: "Explain the following text concisely. Return only the explanation.\n\n{selection}",
    sortOrder: 1
  }
];

interface SelectionActionRow {
  action_id: string;
  name: string;
  prompt: string;
  provider_id?: string | null;
  model_id?: string | null;
  sort_order: number;
  enabled: number;
  created_at_ms: number;
  updated_at_ms: number;
}

function sqlString(value: string): string {
  return `'${escapeSqlLiteral(value)}'`;
}

function sqlNullOrString(value: string | null | undefined): string {
  if (value == null || value === "") return "NULL";
  return sqlString(value);
}

function nowMs(): number {
  return Date.now();
}

function clipBody(body: string, max: number): string {
  if (body.length <= max) return body;
  return `${body.slice(0, max - 1)}…`;
}

function mapSelectionAction(row: SelectionActionRow): SelectionAction {
  return {
    actionId: row.action_id,
    name: row.name,
    prompt: row.prompt,
    providerId: row.provider_id?.trim() || undefined,
    modelId: row.model_id?.trim() || undefined,
    sortOrder: row.sort_order,
    enabled: row.enabled === 1,
    createdAtMs: row.created_at_ms,
    updatedAtMs: row.updated_at_ms
  };
}

export function fillSelectionPrompt(template: string, selection: string): string {
  const text = selection.trim();
  if (!template.trim()) return text;
  if (template.includes("{selection}")) return template.split("{selection}").join(text);
  return `${template.trim()}\n\n${text}`;
}

/** CRUD + execution state for the renderer's selection menu actions. */
export class SelectionStore {
  constructor(private readonly dbPath: string) {}

  async initialize(): Promise<void> {
    await ensureDesktopDbSchema(this.dbPath);
    await this.ensureBuiltinSelectionActions();
  }

  private async ensureBuiltinSelectionActions(): Promise<void> {
    const existing = await this.listSelectionActions();
    const known = new Set(existing.map((item) => item.actionId));
    const now = nowMs();
    for (const action of BUILTIN_SELECTION_ACTIONS) {
      if (known.has(action.actionId)) continue;
      await runSqlite(
        this.dbPath,
        `INSERT INTO selection_actions (
          action_id, name, prompt, sort_order, enabled, created_at_ms, updated_at_ms
        ) VALUES (
          ${sqlString(action.actionId)},
          ${sqlString(action.name)},
          ${sqlString(action.prompt)},
          ${action.sortOrder},
          1,
          ${now},
          ${now}
        );`
      );
    }
  }

  async listSelectionActions(): Promise<SelectionAction[]> {
    const rows = await runSqliteJson<SelectionActionRow>(
      this.dbPath,
      "SELECT * FROM selection_actions ORDER BY sort_order ASC, created_at_ms ASC;"
    );
    return rows.map(mapSelectionAction);
  }

  async getSelectionAction(actionId: string): Promise<SelectionAction | undefined> {
    const rows = await runSqliteJson<SelectionActionRow>(
      this.dbPath,
      `SELECT * FROM selection_actions WHERE action_id = ${sqlString(actionId)} LIMIT 1;`
    );
    return rows[0] ? mapSelectionAction(rows[0]) : undefined;
  }

  async createSelectionAction(input: {
    name: string;
    prompt?: string;
    providerId?: string;
    modelId?: string;
  }): Promise<SelectionAction> {
    const name = input.name.trim();
    if (!name) throw new Error("Action name is required.");
    const prompt = (input.prompt ?? "").slice(0, SELECTION_PROMPT_MAX);
    if (!prompt.trim()) {
      throw new Error("Actions need a prompt. Use {selection} for the highlighted text.");
    }
    const now = nowMs();
    const existing = await this.listSelectionActions();
    const sortOrder = existing.reduce((max, item) => Math.max(max, item.sortOrder), -1) + 1;
    const actionId = randomUUID();
    const providerId = input.providerId?.trim() || null;
    const modelId = input.modelId?.trim() || null;
    await runSqlite(
      this.dbPath,
      `INSERT INTO selection_actions (
        action_id, name, prompt, provider_id, model_id, sort_order, enabled, created_at_ms, updated_at_ms
      ) VALUES (
        ${sqlString(actionId)},
        ${sqlString(name)},
        ${sqlString(prompt)},
        ${sqlNullOrString(providerId)},
        ${sqlNullOrString(modelId)},
        ${sortOrder},
        1,
        ${now},
        ${now}
      );`
    );
    const created = await this.getSelectionAction(actionId);
    if (!created) throw new Error("Failed to load created action.");
    return created;
  }

  async updateSelectionAction(input: {
    actionId: string;
    name?: string;
    prompt?: string;
    providerId?: string | null;
    modelId?: string | null;
    enabled?: boolean;
  }): Promise<SelectionAction> {
    const current = await this.getSelectionAction(input.actionId);
    if (!current) throw new Error("Selection action not found.");
    const name = input.name !== undefined ? input.name.trim() : current.name;
    if (!name) throw new Error("Action name is required.");
    const prompt = input.prompt !== undefined ? input.prompt.slice(0, SELECTION_PROMPT_MAX) : current.prompt;
    if (!prompt.trim()) {
      throw new Error("Actions need a prompt. Use {selection} for the highlighted text.");
    }
    const providerId = input.providerId !== undefined ? (input.providerId?.trim() || null) : (current.providerId || null);
    const modelId = input.modelId !== undefined ? (input.modelId?.trim() || null) : (current.modelId || null);
    const enabled = input.enabled === undefined ? current.enabled : input.enabled;
    const now = nowMs();
    await runSqlite(
      this.dbPath,
      `UPDATE selection_actions SET
        name = ${sqlString(name)},
        prompt = ${sqlString(prompt)},
        provider_id = ${sqlNullOrString(providerId)},
        model_id = ${sqlNullOrString(modelId)},
        enabled = ${enabled ? 1 : 0},
        updated_at_ms = ${now}
       WHERE action_id = ${sqlString(current.actionId)};`
    );
    const updated = await this.getSelectionAction(current.actionId);
    if (!updated) throw new Error("Failed to load updated action.");
    return updated;
  }

  async deleteSelectionAction(actionId: string): Promise<void> {
    if (isBuiltinSelectionActionId(actionId)) {
      throw new Error("Builtin selection actions cannot be deleted.");
    }
    await runSqlite(
      this.dbPath,
      `DELETE FROM selection_actions WHERE action_id = ${sqlString(actionId)};`
    );
  }

  async reorderSelectionActions(actionIds: string[]): Promise<SelectionAction[]> {
    const existing = await this.listSelectionActions();
    const existingIds = new Set(existing.map((item) => item.actionId));
    const nextIds = new Set(actionIds);
    if (nextIds.size !== actionIds.length) {
      throw new Error("Selection action ids must be unique.");
    }
    if (actionIds.length !== existingIds.size || actionIds.some((id) => !existingIds.has(id))) {
      throw new Error("Selection action ids must cover every action exactly once.");
    }
    const now = nowMs();
    await runSqlite(
      this.dbPath,
      [
        "BEGIN IMMEDIATE;",
        ...actionIds.map((actionId, index) =>
          `UPDATE selection_actions SET sort_order = ${index}, updated_at_ms = ${now} WHERE action_id = ${sqlString(actionId)};`
        ),
        "COMMIT;"
      ].join("\n")
    );
    return this.listSelectionActions();
  }

  clipSelectionText(value: string): string {
    return clipBody(value, SELECTION_TEXT_MAX);
  }
}
