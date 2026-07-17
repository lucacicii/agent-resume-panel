import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { AgentSession } from "../catalog/types";

const execFileAsync = promisify(execFile);

/** Alma resume uses AppleScript to focus the Alma app (desktop / external terminal). */
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

/** Focus Alma and navigate to the thread by title (macOS). */
export async function openAlmaThreadInApp(session: AgentSession): Promise<void> {
  if (session.provider !== "alma") {
    throw new Error("Not an Alma session.");
  }
  if (process.platform !== "darwin") {
    throw new Error("Alma UI navigation is only supported on macOS.");
  }

  const searchTitle = pickSearchTitle(session.title);
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

function pickSearchTitle(title: string): string {
  const trimmed = title.trim();
  if (!trimmed) return "";
  const firstLine = trimmed.split("\n")[0]?.trim() || trimmed;
  return firstLine.replace(/\s+/g, " ").slice(0, 80);
}

function toAppleScriptString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function escapeShellDoubleQuoted(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

async function runAlmaAppleScript(script: string, action: string): Promise<void> {
  try {
    await execFileAsync("osascript", ["-e", script], { timeout: 8000 });
  } catch (error) {
    const message = formatError(error);
    if (message.includes("Not authorized") || message.includes("-1743")) {
      throw new Error(
        "macOS Accessibility permission is required. Grant this app access in System Settings → Privacy & Security → Accessibility, then retry."
      );
    }
    throw new Error(`Failed to ${action}: ${message}`);
  }
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}