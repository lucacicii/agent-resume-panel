/**
 * Experimental Grok Build ACP vendor adapter.
 *
 * Grok's `agent stdio` currently omits standard ACP `modes` / `configOptions`.
 * Live probe (Grok agent ~0.2.106):
 * - Session modes work via `session/set_mode` (build / plan / ask) and
 *   emit `current_mode_update`, but `session/new` does not return `modes`.
 * - Reasoning effort lives under `models[]._meta.reasoningEfforts` and is
 *   mislabeled as `category: "mode"` (high/medium/low) in x.ai/sessionConfig.
 * - Effort is set via `session/set_model` + `_meta.reasoningEffort` (not set_mode,
 *   which would collide with real session modes).
 *
 * This module normalizes those fields so the toolbar can show Mode + Model + Effort.
 * Gated by `settings.acp.experimentalGrokVendorUi`.
 *
 * Adapter id: grok-session-meta-v1
 */

import type { AcpSessionModes, SessionMeta } from "../agentConnection";
import type { AcpConfigOption, AcpModelsState } from "../types";

export const GROK_VENDOR_ADAPTER_ID = "grok-session-meta-v1";

/** Synthetic config option ids — host routes these to vendor set methods. */
export const GROK_REASONING_EFFORT_CONFIG_ID = "__grok_reasoning_effort";
export const GROK_MODEL_CONFIG_ID = "__grok_model";
export const GROK_VENDOR_CONFIG_PREFIX = "__grok_";

/** Session modes confirmed via current_mode_update on Grok ACP. */
export const GROK_SESSION_MODES: ReadonlyArray<{ id: string; name: string }> = [
  { id: "build", name: "Build" },
  { id: "plan", name: "Plan" },
  { id: "ask", name: "Ask" }
];

const EFFORT_ID_RE = /^(high|medium|low|xhigh|max|minimal|none)$/i;

export function isGrokVendorConfigId(configId: string): boolean {
  return configId.startsWith(GROK_VENDOR_CONFIG_PREFIX);
}

/**
 * Prefer official standard fields when present; otherwise synthesize
 * modes + model list + thought_level (Effort).
 */
export function applyGrokVendorSessionMeta(
  raw: Record<string, unknown> | null | undefined,
  base: SessionMeta
): SessionMeta {
  if (!raw || typeof raw !== "object") return base;

  const hasOfficialModel = base.configOptions.some(
    (option) => option.type === "select" && option.category === "model"
  );
  const hasOfficialThought = base.configOptions.some(
    (option) => option.type === "select" && option.category === "thought_level"
  );
  const hasOfficialModes = Boolean(base.modes?.availableModes?.length);

  // Fully official — nothing to do.
  if (hasOfficialModel && hasOfficialThought && hasOfficialModes) {
    return base;
  }

  let models = base.models;
  if (!models) {
    models = extractModels(raw.models) ?? extractModelsFromSessionConfig(raw._meta) ?? null;
  }

  let modes = base.modes;
  if (!hasOfficialModes) {
    modes = synthesizeSessionModes(raw._meta, base.modes) ?? modes;
  }

  let configOptions = base.configOptions.filter((option) => !isGrokVendorConfigId(option.id));

  if (!hasOfficialModel && models?.availableModels.length) {
    configOptions.push({
      type: "select",
      id: GROK_MODEL_CONFIG_ID,
      name: "Model",
      category: "model",
      currentValue: models.currentModelId,
      options: models.availableModels.map((entry) => ({
        value: entry.modelId,
        name: entry.name
      }))
    });
  }

  if (!hasOfficialThought) {
    const thought = synthesizeThoughtLevel(raw, models);
    if (thought) configOptions.push(thought);
  }

  return { ...base, modes, models, configOptions };
}

function synthesizeSessionModes(
  meta: unknown,
  existing: AcpSessionModes | null
): AcpSessionModes | null {
  const kind = sessionDetailKind(meta);
  const known = new Set(GROK_SESSION_MODES.map((entry) => entry.id));
  let currentModeId =
    (existing?.currentModeId && known.has(existing.currentModeId) ? existing.currentModeId : "") ||
    (kind && known.has(kind) ? kind : "") ||
    GROK_SESSION_MODES[0]!.id;

  return {
    currentModeId,
    availableModes: GROK_SESSION_MODES.map((entry) => ({ id: entry.id, name: entry.name }))
  };
}

function sessionDetailKind(meta: unknown): string {
  if (!meta || typeof meta !== "object") return "";
  const detail = (meta as { "x.ai/sessionDetail"?: unknown })["x.ai/sessionDetail"];
  if (!detail || typeof detail !== "object") return "";
  const kind = (detail as { kind?: unknown }).kind;
  return typeof kind === "string" ? kind.trim().toLowerCase() : "";
}

function extractModels(value: unknown): AcpModelsState | null {
  if (!value || typeof value !== "object") return null;
  const currentModelId = (value as { currentModelId?: string }).currentModelId;
  const availableModels = (value as { availableModels?: Array<{ modelId?: string; name?: string }> })
    .availableModels;
  if (!currentModelId || !Array.isArray(availableModels) || !availableModels.length) return null;
  const list = availableModels
    .filter((entry) => entry && typeof entry.modelId === "string")
    .map((entry) => ({
      modelId: entry.modelId as string,
      name: typeof entry.name === "string" ? entry.name : (entry.modelId as string)
    }));
  if (!list.length) return null;
  return { currentModelId, availableModels: list };
}

function extractModelsFromSessionConfig(meta: unknown): AcpModelsState | null {
  const options = sessionConfigOptions(meta);
  const models = options.filter((option) => option.category === "model" && option.id);
  if (!models.length) return null;
  const selected = models.find((option) => option.selected) || models[0]!;
  return {
    currentModelId: selected.id,
    availableModels: models.map((option) => ({
      modelId: option.id,
      name: option.label || option.id
    }))
  };
}

function synthesizeThoughtLevel(
  raw: Record<string, unknown>,
  models: AcpModelsState | null
): AcpConfigOption | null {
  // Prefer per-model reasoningEfforts meta.
  const fromModel = thoughtFromModelsMeta(raw.models, models?.currentModelId);
  if (fromModel) return fromModel;

  // Fallback: x.ai/sessionConfig options with category "mode" that look like effort
  // (NOT session modes — Grok mislabels effort as "mode").
  const fromSessionConfig = thoughtFromSessionConfig(raw._meta);
  if (fromSessionConfig) return fromSessionConfig;

  return null;
}

function thoughtFromModelsMeta(modelsRaw: unknown, currentModelId?: string): AcpConfigOption | null {
  if (!modelsRaw || typeof modelsRaw !== "object") return null;
  const available = (modelsRaw as { availableModels?: unknown[] }).availableModels;
  if (!Array.isArray(available)) return null;
  const currentId =
    currentModelId || (modelsRaw as { currentModelId?: string }).currentModelId || "";
  const match =
    available.find(
      (entry) =>
        entry && typeof entry === "object" && (entry as { modelId?: string }).modelId === currentId
    ) || available[0];
  if (!match || typeof match !== "object") return null;
  const meta = (match as { _meta?: unknown })._meta;
  if (!meta || typeof meta !== "object") return null;
  const efforts = (meta as { reasoningEfforts?: unknown }).reasoningEfforts;
  if (!Array.isArray(efforts) || !efforts.length) return null;

  const options: Array<{ value: string; name: string }> = [];
  for (const effort of efforts) {
    if (!effort || typeof effort !== "object") continue;
    const row = effort as { id?: string; value?: string; label?: string; name?: string };
    const value = (row.id || row.value || "").trim();
    if (!value) continue;
    options.push({
      value,
      name: (row.label || row.name || value).trim()
    });
  }
  if (!options.length) return null;

  let currentValue =
    typeof (meta as { reasoningEffort?: string }).reasoningEffort === "string"
      ? (meta as { reasoningEffort: string }).reasoningEffort
      : options[0]!.value;
  if (!options.some((option) => option.value === currentValue)) {
    currentValue = options[0]!.value;
  }

  return {
    type: "select",
    id: GROK_REASONING_EFFORT_CONFIG_ID,
    name: "Effort",
    category: "thought_level",
    currentValue,
    options
  };
}

function thoughtFromSessionConfig(meta: unknown): AcpConfigOption | null {
  const options = sessionConfigOptions(meta).filter((option) => {
    if (option.category !== "mode") return false;
    // Grok mislabels effort as category "mode" — ids high/medium/low (not build/plan/ask).
    return EFFORT_ID_RE.test(option.id);
  });
  if (!options.length) return null;
  const selected = options.find((option) => option.selected) || options[0]!;
  return {
    type: "select",
    id: GROK_REASONING_EFFORT_CONFIG_ID,
    name: "Effort",
    category: "thought_level",
    currentValue: selected.id,
    options: options.map((option) => ({
      value: option.id,
      name: option.label || option.id
    }))
  };
}

type SessionConfigOptionRow = {
  id: string;
  category?: string;
  label?: string;
  selected?: boolean;
  description?: string;
};

function sessionConfigOptions(meta: unknown): SessionConfigOptionRow[] {
  if (!meta || typeof meta !== "object") return [];
  const sessionConfig = (meta as { "x.ai/sessionConfig"?: unknown })["x.ai/sessionConfig"];
  if (!sessionConfig || typeof sessionConfig !== "object") return [];
  const options = (sessionConfig as { options?: unknown }).options;
  if (!Array.isArray(options)) return [];
  const out: SessionConfigOptionRow[] = [];
  for (const raw of options) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const id = typeof row.id === "string" ? row.id : "";
    if (!id) continue;
    out.push({
      id,
      category: typeof row.category === "string" ? row.category : undefined,
      label: typeof row.label === "string" ? row.label : undefined,
      selected: row.selected === true,
      description: typeof row.description === "string" ? row.description : undefined
    });
  }
  return out;
}

/** Confirmed working on Grok ACP: session/set_model */
export async function setGrokModel(
  request: (method: string, params: Record<string, unknown>) => Promise<unknown>,
  sessionId: string,
  modelId: string
): Promise<void> {
  await request("session/set_model", { sessionId, modelId });
}

/**
 * Set reasoning effort without touching session mode.
 * Prefer `session/set_model` + `_meta.reasoningEffort` (avoids clobbering build/plan/ask).
 */
export async function setGrokReasoningEffort(
  request: (method: string, params: Record<string, unknown>) => Promise<unknown>,
  sessionId: string,
  effortId: string,
  modelId: string
): Promise<void> {
  const model = modelId.trim();
  if (!model) {
    throw new Error("Cannot set Grok reasoning effort without a current model id.");
  }
  await request("session/set_model", {
    sessionId,
    modelId: model,
    _meta: { reasoningEffort: effortId }
  });
}
