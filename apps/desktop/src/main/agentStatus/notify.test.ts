import { describe, expect, it, vi } from "vitest";
import { createBlockedNotifier, windowsToastScript } from "./notify";

describe("createBlockedNotifier", () => {
  it("posts one notification per newly blocked pane", () => {
    const run = vi.fn();
    const notifier = createBlockedNotifier({ enabled: true, platform: "darwin", run });
    notifier.notify([{ paneId: 3, agent: "claude" }, { paneId: 4, agent: "codex", title: "fix the build" }]);
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[0]?.[0]).toBe("osascript");
    expect(String(run.mock.calls[0]?.[1]?.[1])).toContain("display notification \"claude needs you");
    expect(String(run.mock.calls[1]?.[1]?.[1])).toContain("fix the build");
  });

  it("posts a WinRT toast through PowerShell on Windows", () => {
    const run = vi.fn();
    createBlockedNotifier({ enabled: true, platform: "win32", run }).notify([
      { paneId: 7, agent: "pi", title: "fix the build" }
    ]);
    expect(run).toHaveBeenCalledTimes(1);
    const [command, args] = run.mock.calls[0] ?? [];
    expect(command).toBe("powershell.exe");
    expect(args).toContain("-EncodedCommand");
    const encoded = String(args?.[args.indexOf("-EncodedCommand") + 1] ?? "");
    const script = Buffer.from(encoded, "base64").toString("utf16le");
    const xml = Buffer.from(
      /FromBase64String\('([^']+)'\)/.exec(script)?.[1] ?? "",
      "base64"
    ).toString("utf8");
    expect(xml).toContain("pi needs you — fix the build");
    expect(script).toContain("ToastNotificationManager");
    expect(script).toContain("com.thunder-luc.agent-resume");
  });

  it("does nothing when disabled or on another platform", () => {
    const run = vi.fn();
    createBlockedNotifier({ enabled: false, platform: "darwin", run }).notify([{ paneId: 1, agent: "pi" }]);
    createBlockedNotifier({ enabled: true, platform: "linux", run }).notify([{ paneId: 1, agent: "pi" }]);
    expect(run).not.toHaveBeenCalled();
  });

  it("escapes quotes so a title cannot break out of the AppleScript literal", () => {
    const run = vi.fn();
    createBlockedNotifier({ enabled: true, platform: "darwin", run }).notify([
      { paneId: 1, agent: "pi", title: 'say "hi" \\ now' }
    ]);
    const script = String(run.mock.calls[0]?.[1]?.[1] ?? "");
    expect(script).toContain('\\"hi\\"');
    expect(script).toContain("\\\\ now");
  });

  it("stays silent for an empty batch", () => {
    const run = vi.fn();
    createBlockedNotifier({ enabled: true, platform: "darwin", run }).notify([]);
    expect(run).not.toHaveBeenCalled();
  });
});

describe("windowsToastScript", () => {
  it("keeps user text out of the command line and escapes the toast XML", () => {
    const script = windowsToastScript("Agent Resume", `a & b <c> "d" 'e'`);
    const encoded = /FromBase64String\('([^']+)'\)/.exec(script)?.[1] ?? "";
    const xml = Buffer.from(encoded, "base64").toString("utf8");
    expect(xml).toContain("a &amp; b &lt;c&gt; &quot;d&quot; &apos;e&apos;");
    expect(script).not.toContain("<c>");
  });
});
