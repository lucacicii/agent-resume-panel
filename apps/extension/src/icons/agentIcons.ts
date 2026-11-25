import * as vscode from "vscode";
import { AcpAgentProvider } from "../acp/types";
import { AgentProvider } from "../history/types";

export type AgentUriIconPath = vscode.Uri | { light: vscode.Uri; dark: vscode.Uri };
export type AgentIconPath = AgentUriIconPath | vscode.ThemeIcon;

type ResolvedProvider = Exclude<AgentProvider, "chat"> | "chat";

const COLOR_ICON_PROVIDERS = new Set<string>(["codex", "claude", "agy", "pi", "omp"]);
const THEMED_ICON_PROVIDERS = new Set<string>(["grok", "opencode", "prime"]);

/** Resolve the official SVG icon path (light/dark aware for monochrome SVGs) for a provider. */
export function agentUriIconPath(
  extensionUri: vscode.Uri,
  provider: AgentProvider,
  acpProvider?: AcpAgentProvider
): AgentUriIconPath | undefined {
  const effective: ResolvedProvider = provider === "chat" && acpProvider ? acpProvider : provider;

  if (COLOR_ICON_PROVIDERS.has(effective)) {
    return vscode.Uri.joinPath(extensionUri, "resources", "agents", `${effective}.svg`);
  }

  if (THEMED_ICON_PROVIDERS.has(effective)) {
    return {
      light: vscode.Uri.joinPath(extensionUri, "resources", "agents", "light", `${effective}.svg`),
      dark: vscode.Uri.joinPath(extensionUri, "resources", "agents", "dark", `${effective}.svg`)
    };
  }

  if (effective === "cursor" || effective === "cursor-ide") {
    return {
      light: vscode.Uri.joinPath(extensionUri, "resources", "agents", "light", "cursor.svg"),
      dark: vscode.Uri.joinPath(extensionUri, "resources", "agents", "dark", "cursor.svg")
    };
  }

  return undefined;
}

/** Resolve an official SVG icon when extensionUri is available, falling back to a VS Code ThemeIcon. */
export function agentIconPath(
  extensionUri: vscode.Uri | undefined,
  provider: AgentProvider,
  acpProvider?: AcpAgentProvider
): AgentIconPath {
  if (extensionUri) {
    const uriIcon = agentUriIconPath(extensionUri, provider, acpProvider);
    if (uriIcon) {
      return uriIcon;
    }
  }
  return new vscode.ThemeIcon(fallbackProviderCodicon(provider));
}

export function fallbackProviderCodicon(provider: AgentProvider): string {
  switch (provider) {
    case "chat":
      return "comment";
    case "codex":
      return "hubot";
    case "agy":
      return "sparkle";
    case "grok":
      return "rocket";
    case "opencode":
      return "terminal";
    case "pi":
      return "symbol-method";
    case "prime":
      return "sparkle";
    case "omp":
      return "symbol-method";
    case "cursor":
    case "cursor-ide":
      return "window";
    default:
      return "comment-discussion";
  }
}

export type WebviewAgentIconEntry = string | { light: string; dark: string };

const WEBVIEW_COLOR_PROVIDERS = ["codex", "claude", "agy", "pi", "omp"] as const;
const WEBVIEW_THEMED_PROVIDERS = ["grok", "opencode", "prime"] as const;

/** Build webview-safe official icon URIs for all integrated agent providers. */
export function buildWebviewAgentIconMap(
  webview: vscode.Webview,
  extensionUri: vscode.Uri
): Record<string, WebviewAgentIconEntry> {
  const map: Record<string, WebviewAgentIconEntry> = {};

  for (const provider of WEBVIEW_COLOR_PROVIDERS) {
    map[provider] = webview
      .asWebviewUri(vscode.Uri.joinPath(extensionUri, "resources", "agents", `${provider}.svg`))
      .toString();
  }

  for (const provider of WEBVIEW_THEMED_PROVIDERS) {
    map[provider] = {
      light: webview
        .asWebviewUri(vscode.Uri.joinPath(extensionUri, "resources", "agents", "light", `${provider}.svg`))
        .toString(),
      dark: webview
        .asWebviewUri(vscode.Uri.joinPath(extensionUri, "resources", "agents", "dark", `${provider}.svg`))
        .toString()
    };
  }

  const cursorPair = {
    light: webview
      .asWebviewUri(vscode.Uri.joinPath(extensionUri, "resources", "agents", "light", "cursor.svg"))
      .toString(),
    dark: webview
      .asWebviewUri(vscode.Uri.joinPath(extensionUri, "resources", "agents", "dark", "cursor.svg"))
      .toString()
  };
  map.cursor = cursorPair;
  map["cursor-ide"] = cursorPair;

  return map;
}
