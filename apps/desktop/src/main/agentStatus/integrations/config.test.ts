import { describe, expect, it } from "vitest";
import {
  countOurHooks,
  ensureCommandHook,
  ensureHooksObject,
  ensureTomlFeature,
  removeOurHooks,
  removeTomlFeature
} from "./config";

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

describe("ensureTomlFeature", () => {
  it("creates the table when the file is empty", () => {
    expect(ensureTomlFeature("", "hooks")).toBe("[features]\nhooks = true\n");
  });

  it("inserts the key into an existing table, preserving comments and other keys", () => {
    const content = [
      "model = \"gpt-5\"",
      "",
      "[features]",
      "# keep this comment",
      "web_search = true",
      "",
      "[other]",
      "x = 1"
    ].join("\n");
    const next = ensureTomlFeature(content, "hooks");
    expect(next).toContain("# keep this comment");
    expect(next).toContain("web_search = true");
    expect(next.indexOf("hooks = true")).toBeGreaterThan(next.indexOf("[features]"));
    expect(next.indexOf("hooks = true")).toBeLessThan(next.indexOf("[other]"));
    expect(next).toContain("model = \"gpt-5\"");
  });

  it("flips an existing false to true", () => {
    const next = ensureTomlFeature("[features]\nhooks = false\n", "hooks");
    expect(next).toBe("[features]\nhooks = true\n");
  });

  it("is idempotent", () => {
    const once = ensureTomlFeature("[features]\nhooks = true\n", "hooks");
    expect(ensureTomlFeature(once, "hooks")).toBe(once);
  });

  it("appends the table when the file has no features section", () => {
    expect(ensureTomlFeature("model = \"gpt-5\"\n", "hooks")).toBe(
      "model = \"gpt-5\"\n\n[features]\nhooks = true\n"
    );
  });
});

describe("removeTomlFeature", () => {
  it("removes the key and the table it emptied", () => {
    // Nothing left in the file at all: an empty string, not a stray newline.
    expect(removeTomlFeature("[features]\nhooks = true\n", "hooks")).toBe("");
  });

  it("keeps the table when other keys remain", () => {
    const content = "[features]\nhooks = true\nweb_search = true\n";
    expect(removeTomlFeature(content, "hooks")).toBe("[features]\nweb_search = true\n");
  });

  it("leaves everything else untouched", () => {
    const content = ["model = \"gpt-5\"", "", "[features]", "hooks = true", "", "[other]", "x = 1"].join("\n");
    const next = removeTomlFeature(content, "hooks");
    expect(next).toContain("model = \"gpt-5\"");
    expect(next).toContain("[other]\nx = 1");
    expect(next).not.toContain("hooks = true");
    expect(next).not.toContain("[features]");
  });

  it("reports no change when the key is absent", () => {
    const content = "[features]\nweb_search = true\n";
    expect(removeTomlFeature(content, "hooks")).toBe(content);
  });
});
