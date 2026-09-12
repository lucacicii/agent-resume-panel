import { describe, expect, it } from "vitest";
import { countOurHooks, ensureCommandHook, ensureHooksObject, removeOurHooks } from "./config";

const OURS = "/Users/x/.agent-resume-panel/.desktop/agent-state/agent-resume-status-claude.sh blocked";
const isOurs = (command: string) => command.includes("agent-resume-status-");

describe("ensureCommandHook", () => {
  it("adds a nested group in the shape Claude and Codex use", () => {
    const hooks: Record<string, unknown> = {};
    expect(ensureCommandHook(hooks, "Notification", OURS, 10, "*")).toBe(true);
    expect(hooks).toEqual({
      Notification: [{ matcher: "*", hooks: [{ type: "command", command: OURS, timeout: 10 }] }]
    });
  });

  it("is idempotent and keeps other tools' hooks", () => {
    const hooks: Record<string, unknown> = {
      Notification: [
        { matcher: "*", hooks: [{ type: "command", command: "other-tool notify", timeout: 5 }] }
      ]
    };
    expect(ensureCommandHook(hooks, "Notification", OURS, 10, "*")).toBe(true);
    expect(ensureCommandHook(hooks, "Notification", OURS, 10, "*")).toBe(false);
    const entries = hooks.Notification as { hooks: unknown[] }[];
    expect(entries).toHaveLength(2);
    expect(entries[0]?.hooks).toHaveLength(1);
  });

  it("leaves an unexpected shape alone", () => {
    const hooks: Record<string, unknown> = { Notification: "not-an-array" };
    expect(ensureCommandHook(hooks, "Notification", OURS, 10)).toBe(false);
    expect(hooks.Notification).toBe("not-an-array");
  });
});

describe("removeOurHooks", () => {
  it("removes our entries and keeps everyone else's", () => {
    const hooks: Record<string, unknown> = {
      Notification: [
        { hooks: [{ type: "command", command: OURS, timeout: 10 }] },
        { hooks: [{ type: "command", command: "other-tool notify", timeout: 5 }] }
      ],
      Stop: [{ hooks: [{ type: "command", command: OURS, timeout: 10 }] }]
    };
    expect(removeOurHooks(hooks, isOurs)).toBe(true);
    expect(hooks.Stop).toBeUndefined();
    expect(hooks.Notification).toEqual([
      { hooks: [{ type: "command", command: "other-tool notify", timeout: 5 }] }
    ]);
    expect(countOurHooks(hooks, isOurs)).toBe(0);
  });

  it("reports no change when nothing of ours is present", () => {
    const hooks: Record<string, unknown> = { Stop: [{ hooks: [{ type: "command", command: "x" }] }] };
    expect(removeOurHooks(hooks, isOurs)).toBe(false);
    expect(countOurHooks(hooks, isOurs)).toBe(0);
  });
});

describe("ensureHooksObject", () => {
  it("creates the object when missing and reuses it when present", () => {
    const container: Record<string, unknown> = {};
    const created = ensureHooksObject(container);
    created.Stop = [];
    expect(container.hooks).toBe(created);
    expect(ensureHooksObject(container)).toBe(created);
  });
});
