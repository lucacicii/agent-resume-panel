import * as vscode from "vscode";
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
import { getAllSettingKeys, LLM_API_KEY_SECRET, SETTING_SECTIONS, SettingField } from "./settingsSchema";

export interface SettingsSnapshot {
  sections: typeof SETTING_SECTIONS;
  values: Record<string, unknown>;
  llmApiKeyConfigured: boolean;
  projectMenu: ProjectMenuEditorState;
}

function getFieldDefault(field: SettingField): unknown {
  return field.default;
}

function readFieldValue(field: SettingField): unknown {
  return readAgentResumeSetting(field.key, getFieldDefault(field));
}

export async function loadSettingsSnapshot(context: vscode.ExtensionContext): Promise<SettingsSnapshot> {
  const config = vscode.workspace.getConfiguration("agentResume");
  const values: Record<string, unknown> = {};

  for (const key of getAllSettingKeys()) {
    const field = SETTING_SECTIONS.flatMap((section) => section.fields).find((entry) => entry.key === key);
    if (field) {
      values[key] = readFieldValue(field);
    }
  }

  const apiKey = await context.secrets.get(LLM_API_KEY_SECRET);
  const envKey = process.env.AGENT_RESUME_LLM_API_KEY?.trim();
  const mainActions = loadMainActions(config);
  const itemOrder = loadItemOrder(config);

  return {
    sections: SETTING_SECTIONS,
    values,
    llmApiKeyConfigured: Boolean(apiKey?.trim() || envKey),
    projectMenu: buildProjectMenuEditorState(mainActions, itemOrder)
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
      throw new Error("Invalid project menu configuration.");
    }

    await saveMainActions(config, nextMainActions);
    await saveItemOrder(config, nextItemOrder);
    await applyProjectMenuContext(nextMainActions, nextItemOrder);
  }

  for (const [key, value] of Object.entries(patch)) {
    if (key === "llm.apiKey" || key === "projectMenu.mainActions" || !allowedKeys.has(key)) {
      continue;
    }

    const field = SETTING_SECTIONS.flatMap((section) => section.fields).find((entry) => entry.key === key);
    if (!field) {
      continue;
    }

    const normalized = normalizeValue(field, value);
    await config.update(key, normalized, vscode.ConfigurationTarget.Global);
  }
}

export async function setLlmApiKey(context: vscode.ExtensionContext, apiKey: string): Promise<void> {
  const trimmed = apiKey.trim();
  if (!trimmed) {
    throw new Error("API key cannot be empty.");
  }
  await context.secrets.store(LLM_API_KEY_SECRET, trimmed);
}

export async function clearLlmApiKey(context: vscode.ExtensionContext): Promise<void> {
  await context.secrets.delete(LLM_API_KEY_SECRET);
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

  return String(value ?? "").trim();
}