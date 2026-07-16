import { execFile } from "node:child_process";
import * as path from "node:path";
import { promisify } from "node:util";
import { resolveAlmaWorkspaceId } from "../history/alma";

const execFileAsync = promisify(execFile);
const DEFAULT_ALMA_API_URL = "http://localhost:23001";

export function getAlmaApiUrl(): string {
  return process.env.ALMA_API_URL?.trim() || DEFAULT_ALMA_API_URL;
}

export function buildAlmaActivateCommand(threadId: string, title: string): string {
  const searchTitle = pickSearchTitle(title);
  return [
    `osascript -e 'tell application "Alma" to activate'`,
    `osascript -e 'tell application "System Events" to tell process "Alma" to keystroke "f" using command down'`,
    `sleep 0.4`,
    `osascript -e 'tell application "System Events" to tell process "Alma" to keystroke "${escapeShellDoubleQuoted(
      searchTitle
    )}"'`,
    `sleep 1.0`,
    `osascript -e 'tell application "System Events" to tell process "Alma" to key code 36'`,
    `# thread: ${threadId}`
  ].join("\n");
}

export async function isAlmaApiRunning(): Promise<boolean> {
  try {
    const response = await fetch(`${getAlmaApiUrl()}/api/threads?limit=1`, {
      method: "GET",
      signal: AbortSignal.timeout(3000)
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function navigateAlmaThreadInUi(title: string): Promise<void> {
  if (process.platform !== "darwin") {
    throw new Error("Alma UI navigation is only supported on macOS.");
  }

  const searchTitle = pickSearchTitle(title);
  if (searchTitle.length < 2) {
    throw new Error("Thread title is too short to search in Alma.");
  }

  const script = `
tell application "Alma" to activate
delay 0.5
tell application "System Events"
  tell process "Alma"
    set frontmost to true
    keystroke "f" using command down
    delay 0.4
    keystroke ${toAppleScriptString(searchTitle)}
    delay 1.0
    key code 36
  end tell
end tell
`;

  await runAlmaAppleScript(script, "navigate Alma thread");
}

export async function openAlmaNewChatInUi(): Promise<void> {
  if (process.platform !== "darwin") {
    throw new Error("Alma new-chat navigation is only supported on macOS.");
  }

  const script = `
tell application "Alma" to activate
delay 0.5
tell application "System Events"
  tell process "Alma"
    set frontmost to true
    keystroke "n" using command down
  end tell
end tell
`;

  await runAlmaAppleScript(script, "open Alma new chat");
}

async function runAlmaAppleScript(script: string, action: string): Promise<void> {
  try {
    await execFileAsync("osascript", ["-e", script], { timeout: 8000 });
  } catch (error) {
    const message = formatError(error);
    if (message.includes("Not authorized") || message.includes("-1743")) {
      throw new Error(
        "macOS Accessibility permission is required. Grant VSCodium access in System Settings → Privacy & Security → Accessibility, then retry."
      );
    }
    throw new Error(`Failed to ${action}: ${message}`);
  }
}

function pickSearchTitle(title: string): string {
  return title.replace(/\s+/g, " ").trim().slice(0, 80);
}

function toAppleScriptString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function escapeShellDoubleQuoted(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

type AlmaSettings = Record<string, unknown> & {
  general?: {
    defaultWorkspaceId?: string | null;
  };
};

export async function setAlmaDefaultWorkspace(workspaceId: string): Promise<void> {
  const response = await fetch(`${getAlmaApiUrl()}/api/settings`, {
    method: "GET",
    signal: AbortSignal.timeout(5000)
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`HTTP ${response.status}${text ? `: ${text}` : ""}`);
  }

  const settings = (await response.json()) as AlmaSettings;
  delete settings.needsEmbeddingRebuild;
  settings.general = {
    ...settings.general,
    defaultWorkspaceId: workspaceId
  };

  const putResponse = await fetch(`${getAlmaApiUrl()}/api/settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
    signal: AbortSignal.timeout(5000)
  });

  if (!putResponse.ok) {
    const text = await putResponse.text().catch(() => "");
    throw new Error(`HTTP ${putResponse.status}${text ? `: ${text}` : ""}`);
  }

  await sleep(400);
}

export async function createAlmaWorkspace(name: string, projectPath: string): Promise<string> {
  const response = await fetch(`${getAlmaApiUrl()}/api/workspaces`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      path: path.resolve(projectPath)
    }),
    signal: AbortSignal.timeout(5000)
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`HTTP ${response.status}${text ? `: ${text}` : ""}`);
  }

  const workspace = (await response.json()) as { id?: string };
  if (!workspace.id) {
    throw new Error("Alma did not return a workspace id.");
  }

  return workspace.id;
}

export async function ensureAlmaWorkspaceId(
  almaDataDir: string,
  projectPath: string,
  projectName: string
): Promise<string> {
  const existing = await resolveAlmaWorkspaceId(almaDataDir, projectPath);
  if (existing) {
    return existing;
  }

  return createAlmaWorkspace(projectName, projectPath);
}

export async function waitForAlmaApi(timeoutMs = 15000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await isAlmaApiRunning()) {
      return true;
    }

    await sleep(500);
  }

  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}