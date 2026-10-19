/**
 * Notifications for panes that started waiting for a human, posted while no
 * window is attached.
 *
 * This is the payoff of the daemon outliving the app: an agent that blocks at
 * 02:00 while every window is closed still reaches the user. It is deliberately
 * narrow — only a transition *into* blocked, only when no window is connected —
 * because a notification that fires while the panel is open in front of you is
 * noise.
 *
 * The daemon is Electron-free, so each platform gets the native mechanism:
 * `osascript` on macOS and a WinRT toast through PowerShell on Windows.
 */

import { execFile } from "node:child_process";

type BlockedNotification = {
  paneId: number;
  agent: string;
  /** Optional session title, when the pane reported one. */
  title?: string;
};

type BlockedNotifier = {
  notify: (items: readonly BlockedNotification[]) => void;
};

type Runner = (command: string, args: string[]) => void;

/**
 * The AUMID a desktop toast must be posted under.
 *
 * Windows only shows a toast for an AppUserModelId that a Start-menu shortcut
 * registered. The packaged app registers this one (it is the id
 * `app.setAppUserModelId` sets and the packager embeds in the exe), so a toast
 * from the daemon appears as Agent Resume. A portable unzip has no shortcut,
 * and Windows then drops the toast — a silent, safe degradation.
 */
const WINDOWS_APP_USER_MODEL_ID = "com.thunder-luc.agent-resume";

export function createBlockedNotifier(input: {
  enabled: boolean;
  platform?: string;
  log?: (message: string) => void;
  /** Injection point for tests. */
  run?: Runner;
}): BlockedNotifier {
  const log = input.log ?? (() => undefined);
  const platform = input.platform ?? process.platform;
  const run: Runner = input.run ?? ((command, args) => {
    execFile(command, args, { timeout: 5_000 }, () => undefined);
  });

  return {
    notify(items) {
      if (!input.enabled || !items.length) return;
      if (platform !== "darwin" && platform !== "win32") return;
      for (const item of items) {
        const subject = item.title?.trim() || `pane ${item.paneId}`;
        const message = `${item.agent} needs you — ${subject}`;
        if (platform === "darwin") {
          run("osascript", ["-e", `display notification ${quote(message)} with title ${quote("Agent Resume")}`]);
        } else {
          run("powershell.exe", [
            "-NoProfile",
            "-NonInteractive",
            "-EncodedCommand",
            encodePowerShell(windowsToastScript("Agent Resume", message))
          ]);
        }
        log(`notified: ${message}`);
      }
    }
  };
}

/** AppleScript string literal: escape backslashes and double quotes. */
function quote(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

/**
 * A PowerShell program that shows one toast.
 *
 * The text is embedded as base64 and decoded inside the script, so no user
 * string ever reaches the command line: titles and messages can contain quotes,
 * `&`, newlines and anything else without needing escaping at the shell layer.
 */
export function windowsToastScript(title: string, message: string): string {
  const xml = [
    "<toast><visual><binding template=\"ToastGeneric\">",
    `<text>${escapeXml(title)}</text>`,
    `<text>${escapeXml(message)}</text>`,
    "</binding></visual></toast>"
  ].join("");
  const encoded = Buffer.from(xml, "utf8").toString("base64");
  return [
    "$ErrorActionPreference = 'Stop'",
    "[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null",
    "[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null",
    `$xmlText = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}'))`,
    "$xml = New-Object Windows.Data.Xml.Dom.XmlDocument",
    "$xml.LoadXml($xmlText)",
    "$toast = New-Object Windows.UI.Notifications.ToastNotification $xml",
    `[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('${WINDOWS_APP_USER_MODEL_ID}').Show($toast)`
  ].join("; ");
}

/**
 * `-EncodedCommand` takes UTF-16LE base64, which keeps the whole program one
 * argument with no quoting, spaces, or newlines for the Windows command line to
 * mangle.
 */
function encodePowerShell(script: string): string {
  return Buffer.from(script, "utf16le").toString("base64");
}
