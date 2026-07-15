import * as vscode from "vscode";
import { DEFAULT_LLM_OUTPUT_LANGUAGE, LlmOutputLanguage, normalizeOutputLanguage } from "./languages";
import { LLM_API_KEY_SECRET } from "../settings/settingsSchema";
import {
  loadPanelSettingsFile,
  loadPanelSettingsFileSync,
  readLlmSettingWithPanelFallback
} from "../settings/panelSettingsFile";

export interface LlmConfig {
  baseUrl: string;
  model: string;
  outputLanguage: LlmOutputLanguage;
  maxContextChars: number;
  apiKey: string;
}

export interface LlmConfigOverrides {
  baseUrl?: string;
  model?: string;
  outputLanguage?: string;
  apiKey?: string;
  maxContextChars?: number;
}

export function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, "");
}

export function buildChatCompletionsUrl(baseUrl: string): string {
  const normalized = normalizeBaseUrl(baseUrl);
  if (normalized.endsWith("/chat/completions")) {
    return normalized;
  }
  return `${normalized}/chat/completions`;
}

/**
 * API key resolution order:
 * 1) overrides
 * 2) VS Code SecretStorage
 * 3) panelHome settings.json (shared with Desktop)
 * 4) env AGENT_RESUME_LLM_API_KEY
 */
export async function getLlmApiKey(context: vscode.ExtensionContext): Promise<string | undefined> {
  const stored = await context.secrets.get(LLM_API_KEY_SECRET);
  if (stored?.trim()) {
    return stored.trim();
  }

  try {
    const panel = await loadPanelSettingsFile();
    if (panel.llm.apiKey?.trim()) {
      return panel.llm.apiKey.trim();
    }
  } catch {
    // ignore unreadable panel settings
  }

  const envKey = process.env.AGENT_RESUME_LLM_API_KEY?.trim();
  return envKey || undefined;
}

export async function getLlmConfig(
  context: vscode.ExtensionContext,
  overrides?: LlmConfigOverrides
): Promise<LlmConfig | undefined> {
  const apiKey = overrides?.apiKey?.trim() || (await getLlmApiKey(context));
  if (!apiKey) {
    return undefined;
  }

  let panelLlm: { baseUrl?: string; model?: string; outputLanguage?: string; maxContextChars?: number } = {};
  try {
    const panel = await loadPanelSettingsFile();
    panelLlm = panel.llm;
  } catch {
    // ignore
  }

  const baseUrl = normalizeBaseUrl(
    overrides?.baseUrl ??
      String(
        readLlmSettingWithPanelFallback(
          "llm.baseUrl",
          panelLlm.baseUrl,
          "https://api.openai.com/v1"
        )
      )
  );
  const model = (
    overrides?.model ??
    String(readLlmSettingWithPanelFallback("llm.model", panelLlm.model, "gpt-4o-mini"))
  ).trim();
  const outputLanguage = normalizeOutputLanguage(
    overrides?.outputLanguage ??
      String(
        readLlmSettingWithPanelFallback(
          "llm.outputLanguage",
          panelLlm.outputLanguage,
          DEFAULT_LLM_OUTPUT_LANGUAGE
        )
      )
  );
  const maxContextChars =
    overrides?.maxContextChars ??
    Number(
      readLlmSettingWithPanelFallback("llm.maxContextChars", panelLlm.maxContextChars, 120000)
    );

  if (!baseUrl || !model) {
    return undefined;
  }

  return {
    baseUrl,
    model,
    outputLanguage,
    maxContextChars: Number.isFinite(maxContextChars) ? maxContextChars : 120000,
    apiKey
  };
}

export async function isLlmConfigured(context: vscode.ExtensionContext): Promise<boolean> {
  return (await getLlmConfig(context)) !== undefined;
}

export function getLlmOutputLanguage(): LlmOutputLanguage {
  try {
    const panel = loadPanelSettingsFileSync();
    return normalizeOutputLanguage(
      String(
        readLlmSettingWithPanelFallback(
          "llm.outputLanguage",
          panel.llm.outputLanguage,
          DEFAULT_LLM_OUTPUT_LANGUAGE
        )
      )
    );
  } catch {
    return normalizeOutputLanguage(
      readAgentResumeSetting("llm.outputLanguage", DEFAULT_LLM_OUTPUT_LANGUAGE)
    );
  }
}

export function readAgentResumeSetting<T>(key: string, defaultValue: T): T {
  const config = vscode.workspace.getConfiguration("agentResume");
  const value = config.get<T>(key);
  if (value !== undefined) {
    return value;
  }

  const dotIndex = key.indexOf(".");
  if (dotIndex > 0) {
    const section = key.slice(0, dotIndex);
    const nestedKey = key.slice(dotIndex + 1);
    const sectionValue = config.get<Record<string, unknown>>(section);
    if (sectionValue && nestedKey in sectionValue && sectionValue[nestedKey] !== undefined) {
      return sectionValue[nestedKey] as T;
    }
  }

  const inspected = config.inspect<T>(key);
  if (inspected?.globalValue !== undefined) {
    return inspected.globalValue;
  }
  if (inspected?.workspaceValue !== undefined) {
    return inspected.workspaceValue;
  }

  return defaultValue;
}

export function llmOverridesFromDraft(draft?: Record<string, unknown>): LlmConfigOverrides | undefined {
  if (!draft) {
    return undefined;
  }

  const overrides: LlmConfigOverrides = {};

  if (typeof draft["llm.baseUrl"] === "string" && draft["llm.baseUrl"].trim()) {
    overrides.baseUrl = draft["llm.baseUrl"];
  }
  if (typeof draft["llm.model"] === "string" && draft["llm.model"].trim()) {
    overrides.model = draft["llm.model"];
  }
  if (typeof draft["llm.apiKey"] === "string" && draft["llm.apiKey"].trim()) {
    overrides.apiKey = draft["llm.apiKey"];
  }
  if (typeof draft["llm.outputLanguage"] === "string" && draft["llm.outputLanguage"].trim()) {
    overrides.outputLanguage = draft["llm.outputLanguage"];
  }
  if (typeof draft["llm.maxContextChars"] === "number") {
    overrides.maxContextChars = draft["llm.maxContextChars"];
  }

  return Object.keys(overrides).length ? overrides : undefined;
}