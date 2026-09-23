import * as fs from "node:fs/promises";
import * as path from "node:path";
import { loadSettings, resolvePanelHome, type PanelSettings } from "@agent-resume/core";

export interface SyncThunderProvidersResult {
  configDir: string;
  providersCount: number;
  modelsCount: number;
}

/**
 * Synchronize Agent Resume Panel's LLM providers, Tool LLM and Chat LLM
 * into Thunder's Config Directory (`models.json` & `auth.json`).
 *
 * This allows Thunder to dynamically discover and use all providers
 * and credentials configured in Agent Resume Panel.
 */
export async function syncPanelProvidersToThunder(
  customSettings?: PanelSettings
): Promise<SyncThunderProvidersResult> {
  const settings = customSettings || (await loadSettings());
  const panelHome = resolvePanelHome(settings.panelHome);
  const thunderDir = path.join(panelHome, "thunder");

  await fs.mkdir(thunderDir, { recursive: true });

  const modelsFile: {
    providers: Record<
      string,
      {
        name: string;
        baseUrl?: string;
        api: string;
        models: Array<{
          id: string;
          name?: string;
          reasoning?: boolean;
          thinkingLevels?: string[];
          defaultThinkingLevel?: string;
        }>;
      }
    >;
  } = {
    providers: {}
  };

  const authFile: Record<string, { apiKey: string }> = {};

  let totalModels = 0;

  // 1. Tool LLM (settings.llm)
  if (settings.llm?.baseUrl && settings.llm?.model) {
    const providerId = "panel-default";
    modelsFile.providers[providerId] = {
      name: "Panel Tool LLM",
      baseUrl: settings.llm.baseUrl,
      api: "openai-completions",
      models: [{ id: settings.llm.model, name: settings.llm.model }]
    };
    if (settings.llm.apiKey) {
      authFile[providerId] = { apiKey: settings.llm.apiKey };
    }
    totalModels += 1;
  }

  // 2. Chat LLM (settings.chatLlm)
  if (settings.chatLlm?.model) {
    const baseUrl = settings.chatLlm.baseUrl || settings.llm?.baseUrl;
    const apiKey = settings.chatLlm.apiKey || settings.llm?.apiKey;
    if (baseUrl) {
      const providerId = "panel-chat";
      modelsFile.providers[providerId] = {
        name: "Panel Chat LLM",
        baseUrl,
        api: "openai-completions",
        models: [{ id: settings.chatLlm.model, name: settings.chatLlm.model }]
      };
      if (apiKey) {
        authFile[providerId] = { apiKey };
      }
      totalModels += 1;
    }
  }

  // 3. Custom Providers Pool (settings.providers)
  if (Array.isArray(settings.providers)) {
    for (const provider of settings.providers) {
      if (!provider.id || !provider.baseUrl) continue;
      const textModels = (provider.models || [])
        .filter((m) => m.kind !== "embedding")
        .map((m) => ({ id: m.id, name: m.id }));

      if (textModels.length > 0) {
        modelsFile.providers[provider.id] = {
          name: provider.name || provider.id,
          baseUrl: provider.baseUrl,
          api: "openai-completions",
          models: textModels
        };
        if (provider.apiKey) {
          authFile[provider.id] = { apiKey: provider.apiKey };
        }
        totalModels += textModels.length;
      }
    }
  }

  const modelsPath = path.join(thunderDir, "models.json");
  const authPath = path.join(thunderDir, "auth.json");

  await fs.writeFile(modelsPath, JSON.stringify(modelsFile, null, 2), "utf8");
  await fs.writeFile(authPath, JSON.stringify(authFile, null, 2), "utf8");

  const providersCount = Object.keys(modelsFile.providers).length;

  console.log(
    `[thunder-provider-sync] Exported ${providersCount} providers with ${totalModels} models to ${thunderDir}`
  );

  return {
    configDir: thunderDir,
    providersCount,
    modelsCount: totalModels
  };
}
