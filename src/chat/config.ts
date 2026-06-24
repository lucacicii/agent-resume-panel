import * as vscode from "vscode";

const DEFAULT_BASE_URL = "https://api.openai.com/v1";

export interface ChatApiConfig {
  baseUrl: string;
  apiKey?: string;
}

export function getChatBaseUrl(): string {
  const configured = vscode.workspace.getConfiguration("agentResume").get<string>("chatBaseUrl", DEFAULT_BASE_URL).trim();
  return configured || DEFAULT_BASE_URL;
}

export async function getChatApiKey(context: vscode.ExtensionContext): Promise<string | undefined> {
  const fromSettings = vscode.workspace.getConfiguration("agentResume").get<string>("chatApiKey", "").trim();
  if (fromSettings) {
    return fromSettings;
  }

  return context.secrets.get("agentResume.chatApiKey");
}

export async function getChatApiConfig(context: vscode.ExtensionContext): Promise<ChatApiConfig> {
  const apiKey = await getChatApiKey(context);
  return {
    baseUrl: getChatBaseUrl(),
    apiKey
  };
}