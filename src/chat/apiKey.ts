import * as vscode from "vscode";

const SECRET_KEY = "agentResume.chatApiKey";
const CONFIG_KEY = "chatApiKey";

export async function setChatApiKey(context: vscode.ExtensionContext): Promise<boolean> {
  const config = vscode.workspace.getConfiguration("agentResume");
  const current = config.get<string>(CONFIG_KEY, "").trim();
  const value = await vscode.window.showInputBox({
    title: "Agent Resume Chat API Key",
    prompt: "Enter an OpenAI-compatible API key. It will be saved to user settings (agentResume.chatApiKey).",
    password: true,
    ignoreFocusOut: true,
    value: current ? "********" : undefined
  });

  if (value === undefined) {
    return false;
  }

  if (value === "********" && current) {
    return true;
  }

  if (!value.trim()) {
    await config.update(CONFIG_KEY, "", vscode.ConfigurationTarget.Global);
    await context.secrets.delete(SECRET_KEY);
    vscode.window.showInformationMessage("Chat API key cleared.");
    return false;
  }

  await config.update(CONFIG_KEY, value.trim(), vscode.ConfigurationTarget.Global);
  await context.secrets.delete(SECRET_KEY);
  vscode.window.showInformationMessage("Chat API key saved to settings.");
  return true;
}