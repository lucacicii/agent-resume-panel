import { describe, expect, it } from "vitest";
import {
  filterTuiSlashCommands,
  formatTuiSlashInput,
  mergeComposerSlashItems,
  parseLeadingTuiSlash,
  tuiSlashCommandsForProvider
} from "./tuiSlashCommands";

describe("tuiSlashCommandsForProvider", () => {
  it("falls back to shared commands without a provider", () => {
    const names = tuiSlashCommandsForProvider(undefined).map((item) => item.name);
    expect(names).toEqual(["help", "clear", "compact", "model", "new", "quit", "exit"]);
    expect(tuiSlashCommandsForProvider("")).toBe(tuiSlashCommandsForProvider(undefined));
    expect(names).not.toContain("tokens");
  });

  it("includes shared commands plus Codex extras", () => {
    const names = tuiSlashCommandsForProvider("codex").map((item) => item.name);
    expect(names).toContain("clear");
    expect(names).toContain("compact");
    expect(names).toContain("model");
    expect(names).toContain("review");
    expect(names).toContain("tokens");
  });

  it("keeps Claude extras without Codex-only tokens", () => {
    const names = tuiSlashCommandsForProvider("claude").map((item) => item.name);
    expect(names).toContain("permissions");
    expect(names).not.toContain("tokens");
  });

  it("returns a stable array identity for the same provider", () => {
    expect(tuiSlashCommandsForProvider("codex")).toBe(tuiSlashCommandsForProvider("codex"));
    expect(tuiSlashCommandsForProvider(undefined)).toBe(tuiSlashCommandsForProvider(""));
  });
});

describe("mergeComposerSlashItems", () => {
  it("lists matching commands before phrases", () => {
    const items = mergeComposerSlashItems(
      tuiSlashCommandsForProvider("codex"),
      [{ trigger: "clearly", phrase: "looks clear" }, { trigger: "review", phrase: "please review" }],
      "cle"
    );
    expect(items.map((item) => item.kind === "command" ? item.command.name : item.trigger)).toEqual(["clear", "clearly"]);
  });
});

describe("parseLeadingTuiSlash", () => {
  const commands = tuiSlashCommandsForProvider("codex");

  it("matches a whole-input command with optional args", () => {
    expect(parseLeadingTuiSlash("/clear", commands)).toEqual({
      name: "clear",
      args: "",
      needsTerminalFocus: false
    });
    expect(parseLeadingTuiSlash("/model gpt-5", commands)).toEqual({
      name: "model",
      args: "gpt-5",
      needsTerminalFocus: true
    });
  });

  it("ignores mixed prose and unknown tokens", () => {
    expect(parseLeadingTuiSlash("please /clear", commands)).toBeNull();
    expect(parseLeadingTuiSlash("/not-a-command", commands)).toBeNull();
  });
});

describe("formatTuiSlashInput", () => {
  it("appends a carriage return so the TUI executes", () => {
    expect(formatTuiSlashInput("clear")).toBe("/clear\r");
    expect(formatTuiSlashInput("model", "gpt-5")).toBe("/model gpt-5\r");
  });
});

describe("filterTuiSlashCommands", () => {
  it("matches a case-insensitive prefix", () => {
    const names = filterTuiSlashCommands(tuiSlashCommandsForProvider("codex"), "Co").map((item) => item.name);
    expect(names).toEqual(["compact"]);
  });
});
