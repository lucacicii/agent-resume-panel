/**
 * Installer round trips: the promise is "installing adds only our entries, and
 * uninstalling puts the file back exactly as it was".
 *
 * A real bug lived here: uninstall mutated the parsed JSON and then compared it
 * against itself, so the write was skipped and the hooks stayed in the file.
 * That is why these assertions are byte-for-byte instead of "looks about right".
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  claudeSettingsPath,
  codexHooksPath,
  installClaudeHooks,
  installCodexHooks,
  listAgentIntegrations,
  uninstallClaudeHooks,
  uninstallCodexHooks,
  type AgentIntegrationContext
} from "./index";

const homes: string[] = [];

function context(): AgentIntegrationContext {
  const home = mkdtempSync(path.join(os.tmpdir(), "agent-status-install-"));
  homes.push(home);
  return {
    home,
    panelHome: path.join(home, "panel-home"),
    execPath: "/Applications/Agent Resume.app/Contents/MacOS/Agent Resume",
    cliPath: "/Applications/Agent Resume.app/Contents/Resources/app.asar/dist/main/agentStatus/cli.js"
  };
}

function readJson(file: string): Record<string, unknown> {
  return JSON.parse(readFileSync(file, "utf8"));
}

function hookCommands(file: string): string[] {
  const hooks = (readJson(file).hooks ?? {}) as Record<string, unknown>;
  const commands: string[] = [];
  for (const groups of Object.values(hooks)) {
    if (!Array.isArray(groups)) continue;
    for (const group of groups) {
      const handlers = (group as { hooks?: unknown }).hooks;
      if (!Array.isArray(handlers)) continue;
      for (const handler of handlers) {
        const command = (handler as { command?: unknown }).command;
        if (typeof command === "string") commands.push(command);
      }
    }
  }
  return commands;
}

afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

describe("claude hooks", () => {
  it("adds our events, keeps other tools' hooks, and restores the file on uninstall", () => {
    const ctx = context();
    const file = claudeSettingsPath(ctx);
    const original = `${JSON.stringify(
      {
        model: "gpt-5",
        hooks: { Stop: [{ hooks: [{ type: "command", command: "other-tool notify" }] }] }
      },
      null,
      2
    )}\n`;
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, original, "utf8");

    installClaudeHooks(ctx);
    const installed = readJson(file);
    expect(Object.keys((installed.hooks ?? {}) as object).sort()).toEqual([
      "Notification",
      "PreToolUse",
      "SessionStart",
      "Stop",
      "UserPromptSubmit"
    ]);
    expect(hookCommands(file)).toContain("other-tool notify");

    // Installing twice must not rewrite the file.
    const afterFirst = readFileSync(file, "utf8");
    expect(installClaudeHooks(ctx).changed).toBe(false);
    expect(readFileSync(file, "utf8")).toBe(afterFirst);

    uninstallClaudeHooks(ctx);
    expect(readFileSync(file, "utf8")).toBe(original);
  });

  it("reports the integration as installed once the events are present", () => {
    const ctx = context();
    installClaudeHooks(ctx);
    const claude = listAgentIntegrations(ctx).find((entry) => entry.id === "claude");
    expect(claude?.installed).toBe(true);
    uninstallClaudeHooks(ctx);
    const after = listAgentIntegrations(ctx).find((entry) => entry.id === "claude");
    expect(after?.installed).toBe(false);
  });
});

describe("codex hooks", () => {
  it("writes the nesting Codex expects and leaves config.toml alone", () => {
    const ctx = context();
    installCodexHooks(ctx);
    const file = codexHooksPath(ctx);
    const written = readJson(file);
    // Codex's parser accepts `{ description?, hooks: { Event: [ { hooks: [...] } ] } }`.
    expect(Object.keys(written)).toEqual(["hooks"]);
    const hooks = written.hooks as Record<string, unknown>;
    expect(Object.keys(hooks).sort()).toEqual([
      "PermissionRequest",
      "PreToolUse",
      "SessionStart",
      "Stop",
      "UserPromptSubmit"
    ]);
    expect(hookCommands(file).every((command) => command.includes("agent-resume-status-codex.sh"))).toBe(true);
    // The `hooks` feature is enabled by default, so the user's config is untouched.
    expect(existsSync(path.join(ctx.home ?? "", ".codex", "config.toml"))).toBe(false);
  });

  it("keeps another tool's hooks and removes only ours", () => {
    const ctx = context();
    const file = codexHooksPath(ctx);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(
      file,
      `${JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: "other-tool notify" }] }] } }, null, 2)}\n`,
      "utf8"
    );

    installCodexHooks(ctx);
    expect(hookCommands(file)).toContain("other-tool notify");
    expect(hookCommands(file).length).toBeGreaterThan(1);

    uninstallCodexHooks(ctx);
    expect(hookCommands(file)).toEqual(["other-tool notify"]);
  });
});
