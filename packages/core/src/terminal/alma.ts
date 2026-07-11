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

function pickSearchTitle(title: string): string {
  const trimmed = title.trim();
  if (!trimmed) return "";
  const firstLine = trimmed.split("\n")[0]?.trim() || trimmed;
  return firstLine.slice(0, 80);
}

function escapeShellDoubleQuoted(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}