import { describe, expect, it, vi } from "vitest";
import { createBlockedNotifier } from "./notify";

describe("createBlockedNotifier", () => {
  it("posts one notification per newly blocked pane", () => {
    const run = vi.fn();
    const notifier = createBlockedNotifier({ enabled: true, platform: "darwin", run });
    notifier.notify([{ paneId: 3, agent: "claude" }, { paneId: 4, agent: "codex", title: "fix the build" }]);
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[0]?.[0]).toContain("display notification \"claude needs you");
    expect(run.mock.calls[1]?.[0]).toContain("fix the build");
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
    const script = String(run.mock.calls[0]?.[0] ?? "");
    expect(script).toContain('\\"hi\\"');
    expect(script).toContain("\\\\ now");
  });

  it("stays silent for an empty batch", () => {
    const run = vi.fn();
    createBlockedNotifier({ enabled: true, platform: "darwin", run }).notify([]);
    expect(run).not.toHaveBeenCalled();
  });
});
