import * as vscode from "vscode";
import { normalizeOutputLanguagePreference } from "@agent-resume/core/extension";
import { readAgentResumeSetting } from "../llm/config";
import {
  applyProjectMenuContext,
  buildProjectMenuEditorState,
  loadItemOrder,
  loadMainActions,
  itemOrderFromEditorState,
  mainActionsFromEditorState,
  normalizeMainActions,
  ProjectMenuEditorState,
  saveItemOrder,
  saveMainActions
} from "../menu/projectContextMenu";
import {
  applySessionMenuContext,
  buildSessionMenuEditorState,
  loadMainSessionActions,
  loadSessionItemOrder,
  mainSessionActionsFromEditorState,
  saveMainSessionActions,
  saveSessionItemOrder,
  SessionMenuEditorState,
  sessionItemOrderFromEditorState
} from "../menu/sessionContextMenu";
import { t } from "../i18n";
import {
  findSettingField,
  getAllSettingKeys,
  getSettingSections,
  LLM_API_KEY_SECRET,
  SettingField,
  SettingSection
} from "./settingsSchema";
import {
  loadPanelSettingsFile,
  readLlmSettingWithPanelFallback,
  upsertPanelLlmFields
} from "./panelSettingsFile";

export interface SettingsSnapshot {
  sections: SettingSection[];
  values: Record<string, unknown>;
  llmApiKeyConfigured: boolean;
  projectMenu: ProjectMenuEditorState;
  sessionMenu: SessionMenuEditorState;
}

function getFieldDefault(field: SettingField): unknown {
  return field.default;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function readFieldValue(field: SettingField): unknown {
  return readAgentResumeSetting(field.key, getFieldDefault(field));
}

export async function loadSettingsSnapshot(context: vscode.ExtensionContext): Promise<SettingsSnapshot> {
  const config = vscode.workspace.getConfiguration("agentResume");
  const values: Record<string, unknown> = {};

  let panel: Awaited<ReturnType<typeof loadPanelSettingsFile>> | undefined;
  try {
    panel = await loadPanelSettingsFile();
  } catch {
    panel = undefined;
  }

  for (const key of getAllSettingKeys()) {
    const field = findSettingField(key);
    if (!field) {
      continue;
    }

    if (key === "llm.baseUrl") {
      values[key] = readLlmSettingWithPanelFallback(key, panel?.llm.baseUrl, field.default as string);
    } else if (key === "llm.model") {
      values[key] = readLlmSettingWithPanelFallback(key, panel?.llm.model, field.default as string);
    } else if (key === "llm.outputLanguage") {
      const raw = readLlmSettingWithPanelFallback(
        key,
        panel?.llm.outputLanguage,
        field.default as string
      );
      values[key] = normalizeOutputLanguagePreference(String(raw));
    } else if (key === "llm.maxContextChars") {
      values[key] = readLlmSettingWithPanelFallback(
        key,
        panel?.llm.maxContextChars,
        field.default as number
      );
    } else {
      values[key] = readFieldValue(field);
    }
  }

  const apiKey = await context.secrets.get(LLM_API_KEY_SECRET);
  const panelKey = panel?.llm.apiKey?.trim();
  const envKey = process.env.AGENT_RESUME_LLM_API_KEY?.trim();
  const mainActions = loadMainActions(config);
  const itemOrder = loadItemOrder(config);
  const sessionMainActions = loadMainSessionActions(config);
  const sessionItemOrder = loadSessionItemOrder(config);

  return {
    sections: getSettingSections(),
    values,
    llmApiKeyConfigured: Boolean(apiKey?.trim() || panelKey || envKey),
    projectMenu: buildProjectMenuEditorState(mainActions, itemOrder),
    sessionMenu: buildSessionMenuEditorState(sessionMainActions, sessionItemOrder)
  };
}

export async function applySettingsPatch(
  context: vscode.ExtensionContext,
  patch: Record<string, unknown>
): Promise<void> {
  const config = vscode.workspace.getConfiguration("agentResume");
  const allowedKeys = new Set(getAllSettingKeys());

  if ("llm.apiKey" in patch) {
    const apiKey = String(patch["llm.apiKey"] ?? "").trim();
    if (apiKey) {
      await setLlmApiKey(context, apiKey);
    }
  }

  const llmPanelPatch: {
    baseUrl?: string;
    model?: string;
    outputLanguage?: string;
    maxContextChars?: number;
  } = {};

  if ("projectMenu.mainActions" in patch) {
    const raw = patch["projectMenu.mainActions"];
    let nextMainActions;
    let nextItemOrder;

    if (Array.isArray(raw) && raw.every((entry) => typeof entry === "string")) {
      nextMainActions = normalizeMainActions(raw);
      nextItemOrder = loadItemOrder(config);
    } else if (
      raw &&
      typeof raw === "object" &&
      Array.isArray((raw as { order?: unknown }).order) &&
      Array.isArray((raw as { checked?: unknown }).checked)
    ) {
      const editor = raw as { order: string[]; checked: string[] };
      nextMainActions = mainActionsFromEditorState(editor.order, editor.checked);
      nextItemOrder = itemOrderFromEditorState(editor.order);
    } else {
      throw new Error(t("error.settingsInvalidProjectMenu"));
    }

    await saveMainActions(config, nextMainActions);
    await saveItemOrder(config, nextItemOrder);
    await applyProjectMenuContext(nextMainActions, nextItemOrder);
  }

  if ("sessionMenu.mainActions" in patch) {
    const raw = patch["sessionMenu.mainActions"];
    let nextMainActions;
    let nextItemOrder;

    if (Array.isArray(raw) && raw.every((entry) => typeof entry === "string")) {
      nextMainActions = mainSessionActionsFromEditorState(raw, raw);
      nextItemOrder = sessionItemOrderFromEditorState(raw);
    } else if (
      raw &&
      typeof raw === "object" &&
      Array.isArray((raw as { order?: unknown }).order) &&
      Array.isArray((raw as { checked?: unknown }).checked)
    ) {
      const editor = raw as { order: string[]; checked: string[] };
      nextMainActions = mainSessionActionsFromEditorState(editor.order, editor.checked);
      nextItemOrder = sessionItemOrderFromEditorState(editor.order);
    } else {
      throw new Error(t("error.settingsInvalidSessionMenu"));
    }

    await saveMainSessionActions(config, nextMainActions);
    await saveSessionItemOrder(config, nextItemOrder);
    await applySessionMenuContext(nextMainActions, nextItemOrder);
  }

  for (const [key, value] of Object.entries(patch)) {
    if (
      key === "llm.apiKey" ||
      key === "projectMenu.mainActions" ||
      key === "sessionMenu.mainActions" ||
      !allowedKeys.has(key)
    ) {
      continue;
    }

    const field = findSettingField(key);
    if (!field) {
      continue;
    }

    const normalized = normalizeValue(field, value);
    await config.update(key, normalized, vscode.ConfigurationTarget.Global);

    if (key === "llm.baseUrl" && typeof normalized === "string") {
      llmPanelPatch.baseUrl = normalized;
    } else if (key === "llm.model" && typeof normalized === "string") {
      llmPanelPatch.model = normalized;
    } else if (key === "llm.outputLanguage" && typeof normalized === "string") {
      llmPanelPatch.outputLanguage = normalized;
    } else if (key === "llm.maxContextChars" && typeof normalized === "number") {
      llmPanelPatch.maxContextChars = normalized;
    }
  }

  // Keep ~/.agent-resume-panel/settings.json in sync for Desktop + core.
  if (
    llmPanelPatch.baseUrl !== undefined ||
    llmPanelPatch.model !== undefined ||
    llmPanelPatch.outputLanguage !== undefined ||
    llmPanelPatch.maxContextChars !== undefined
  ) {
    try {
      await upsertPanelLlmFields(llmPanelPatch);
    } catch {
      // Non-fatal: VS Code settings already applied.
    }
  }
}

export async function setLlmApiKey(context: vscode.ExtensionContext, apiKey: string): Promise<void> {
  const trimmed = apiKey.trim();
  if (!trimmed) {
    throw new Error(t("error.settingsApiKeyEmpty"));
  }
  await context.secrets.store(LLM_API_KEY_SECRET, trimmed);
  try {
    await upsertPanelLlmFields({ apiKey: trimmed });
  } catch {
    // Secret still stored; panel file sync is best-effort.
  }
}

export async function clearLlmApiKey(context: vscode.ExtensionContext): Promise<void> {
  await context.secrets.delete(LLM_API_KEY_SECRET);
  try {
    await upsertPanelLlmFields({ clearApiKey: true });
  } catch {
    // ignore
  }
}

function normalizeValue(field: SettingField, value: unknown): unknown {
  if (field.type === "boolean") {
    return Boolean(value);
  }

  if (field.type === "number") {
    const parsed = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(parsed)) {
      return field.default;
    }
    if (field.minimum !== undefined) {
      return Math.max(field.minimum, parsed);
    }
    if (field.maximum !== undefined) {
      return Math.min(field.maximum, parsed);
    }
    return parsed;
  }

  if (field.type === "enum" && field.enum) {
    const text = String(value ?? "").trim();
    return field.enum.includes(text) ? text : field.default;
  }

  if (field.type === "stringArray") {
    if (isStringArray(value)) {
      return value.map((entry) => entry.trim()).filter(Boolean);
    }
    if (typeof value === "string") {
      return value
        .split("\n")
        .map((entry) => entry.trim())
        .filter(Boolean);
    }
    return isStringArray(field.default) ? [...field.default] : [];
  }

  return String(value ?? "").trim();
}
