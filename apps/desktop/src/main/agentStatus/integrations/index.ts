/**
 * Agent status integrations: install the hook that lets an agent report its own
 * state, instead of the panel guessing it from the screen.
 *
 * The state is decided at install time, per lifecycle event, so the hook script
 * (`wrapper.ts`) needs no payload parsing and cannot misfire on a payload shape
 * change. Every installer is idempotent, marks its entries by pointing them at
 * our wrapper, and removes only its own entries on uninstall.
 *
 * `opencode` is deliberately absent: its plugin registration differs across
 * versions (TUI plugin dir vs CLI `cli.json` list vs a v2 directory), and
 * shipping a wrong installer that edits the user's config is worse than relying
 * on the screen rules and process identity that already cover it.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  countOurHooks,
  ensureCommandHook,
  ensureHooksObject,
  ensureTomlFeature,
  readJsonObject,
  removeOurHooks,
  removeTomlFeature,
  writeJsonObjectIfChanged
} from "./config";
import { installPiExtension, piExtensionInstalled, piExtensionPath } from "./pi";
import { isOurCommand, materializeWrapper, type WrapperConfig } from "./wrapper";

export type AgentIntegrationId = "claude" | "codex" | "pi";

export type AgentIntegrationContext = {
  panelHome: string;
  /** Absolute path of the app executable, used as the Node runtime for the CLI. */
  execPath: string;
  /** Absolute path of the compiled status CLI inside the app bundle. */
  cliPath: string;
  /** Overrides the user home; tests pass a temp directory. */
  home?: string;
};

export type AgentIntegrationStatus = {
  id: AgentIntegrationId;
  label: string;
  /** The agent looks installed on this machine. */
  detected: boolean;
  /** Our hooks are present and complete. */
  installed: boolean;
  /** Human-readable summary for the settings row. */
  detail: string;
  configPath?: string;
};

export function homeDir(ctx: AgentIntegrationContext): string {
  return ctx.home ?? os.homedir();
}

/** One lifecycle event and the state it proves. */
export type HookSpec = { event: string; state: "idle" | "working" | "blocked"; matcher?: string };

/** Claude Code: hooks live in `~/.claude/settings.json`. */
export const CLAUDE_HOOKS: readonly HookSpec[] = [
  { event: "SessionStart", state: "idle", matcher: "*" },
  { event: "UserPromptSubmit", state: "working" },
  { event: "PreToolUse", state: "working" },
  { event: "Notification", state: "blocked" },
  { event: "Stop", state: "idle" }
];

/** Codex: hooks live in `~/.codex/hooks.json`, enabled from `config.toml`. */
export const CODEX_HOOKS: readonly HookSpec[] = [
  { event: "SessionStart", state: "idle" },
  { event: "UserPromptSubmit", state: "working" },
  { event: "PreToolUse", state: "working" },
  { event: "PermissionRequest", state: "blocked" },
  { event: "Stop", state: "idle" }
];

const HOOK_TIMEOUT_SECONDS = 10;

export function claudeSettingsPath(ctx: AgentIntegrationContext): string {
  return path.join(homeDir(ctx), ".claude", "settings.json");
}

export function codexDir(ctx: AgentIntegrationContext): string {
  return path.join(homeDir(ctx), ".codex");
}

function wrapperFor(ctx: AgentIntegrationContext, agent: AgentIntegrationId): WrapperConfig {
  return {
    panelHome: ctx.panelHome,
    execPath: ctx.execPath,
    cliPath: ctx.cliPath,
    agent
  };
}

// ------------------------------------------------------------------------- Claude

export function installClaudeHooks(ctx: AgentIntegrationContext): { configPath: string; changed: boolean } {
  const configPath = claudeSettingsPath(ctx);
  const wrapper = materializeWrapper(wrapperFor(ctx, "claude"));
  const read = readJsonObject(configPath);
  if (!read.ok) throw new Error(`could not parse ${configPath}: ${read.error}`);

  const settings = read.value;
  const hooks = ensureHooksObject(settings);
  let changed = false;
  for (const spec of CLAUDE_HOOKS) {
    changed = ensureCommandHook(
      hooks,
      spec.event,
      `${wrapper} ${spec.state}`,
      HOOK_TIMEOUT_SECONDS,
      spec.matcher
    ) || changed;
  }
  mkdirSync(path.dirname(configPath), { recursive: true });
  const wrote = writeJsonObjectIfChanged(configPath, settings, read.existed ? settings : null);
  return { configPath, changed: changed && wrote };
}

export function uninstallClaudeHooks(ctx: AgentIntegrationContext): { configPath: string; changed: boolean } {
  const configPath = claudeSettingsPath(ctx);
  const read = readJsonObject(configPath);
  if (!read.ok) throw new Error(`could not parse ${configPath}: ${read.error}`);
  if (!read.existed) return { configPath, changed: false };

  const settings = read.value;
  const hooksValue = settings.hooks;
  if (!hooksValue || typeof hooksValue !== "object" || Array.isArray(hooksValue)) {
    return { configPath, changed: false };
  }
  const changed = removeOurHooks(hooksValue as Record<string, unknown>, (command) =>
    isOurCommand(command, { panelHome: ctx.panelHome })
  );
  if (changed) writeJsonObjectIfChanged(configPath, settings, settings);
  return { configPath, changed };
}

function claudeStatus(ctx: AgentIntegrationContext): AgentIntegrationStatus {
  const configPath = claudeSettingsPath(ctx);
  const detected = existsSync(path.join(homeDir(ctx), ".claude"));
  const read = readJsonObject(configPath);
  const hooks = read.ok ? read.value.hooks : undefined;
  const installed = read.ok && hooks && typeof hooks === "object" && !Array.isArray(hooks)
    ? countOurHooks(hooks as Record<string, unknown>, (command) =>
        isOurCommand(command, { panelHome: ctx.panelHome })
      ) >= CLAUDE_HOOKS.length
    : false;
  return {
    id: "claude",
    label: "Claude Code",
    detected,
    installed,
    detail: read.ok
      ? `${CLAUDE_HOOKS.length} lifecycle hooks in settings.json`
      : `settings.json is unreadable (${read.error})`,
    configPath
  };
}

// --------------------------------------------------------------------------- Codex

export function codexHooksPath(ctx: AgentIntegrationContext): string {
  return path.join(codexDir(ctx), "hooks.json");
}

export function codexConfigPath(ctx: AgentIntegrationContext): string {
  return path.join(codexDir(ctx), "config.toml");
}

export function installCodexHooks(ctx: AgentIntegrationContext): { configPath: string; changed: boolean } {
  const dir = codexDir(ctx);
  const hooksPath = codexHooksPath(ctx);
  const configPath = codexConfigPath(ctx);
  const wrapper = materializeWrapper(wrapperFor(ctx, "codex"));
  mkdirSync(dir, { recursive: true });

  const read = readJsonObject(hooksPath);
  if (!read.ok) throw new Error(`could not parse ${hooksPath}: ${read.error}`);
  const hooksFile = read.value;
  const hooks = ensureHooksObject(hooksFile);
  let changed = false;
  for (const spec of CODEX_HOOKS) {
    changed = ensureCommandHook(hooks, spec.event, `${wrapper} ${spec.state}`, HOOK_TIMEOUT_SECONDS) || changed;
  }
  const wroteHooks = writeJsonObjectIfChanged(hooksPath, hooksFile, read.existed ? hooksFile : null);

  const existingConfig = existsSync(configPath) ? readFileSync(configPath, "utf8") : "";
  const nextConfig = ensureTomlFeature(existingConfig, "hooks");
  let wroteConfig = false;
  if (nextConfig !== existingConfig) {
    const temporary = `${configPath}.agent-resume.tmp`;
    writeFileSync(temporary, nextConfig, { mode: 0o600 });
    renameSync(temporary, configPath);
    wroteConfig = true;
  }
  return { configPath, changed: (changed && wroteHooks) || wroteConfig };
}

export function uninstallCodexHooks(ctx: AgentIntegrationContext): { configPath: string; changed: boolean } {
  const hooksPath = codexHooksPath(ctx);
  const configPath = codexConfigPath(ctx);
  let changed = false;

  const read = readJsonObject(hooksPath);
  if (read.ok && read.existed) {
    const hooksFile = read.value;
    const hooksValue = hooksFile.hooks;
    if (hooksValue && typeof hooksValue === "object" && !Array.isArray(hooksValue)) {
      const removed = removeOurHooks(hooksValue as Record<string, unknown>, (command) =>
        isOurCommand(command, { panelHome: ctx.panelHome })
      );
      if (removed) {
        writeJsonObjectIfChanged(hooksPath, hooksFile, hooksFile);
        changed = true;
      }
    }
  }

  if (existsSync(configPath)) {
    const existing = readFileSync(configPath, "utf8");
    // Only drop the flag once no hook of ours is left in the hooks file.
    const stillInstalled = read.ok
      && typeof read.value.hooks === "object"
      && countOurHooks(read.value.hooks as Record<string, unknown>, (command) =>
        isOurCommand(command, { panelHome: ctx.panelHome })
      ) > 0;
    if (!stillInstalled) {
      const next = removeTomlFeature(existing, "hooks");
      if (next !== existing) {
        const temporary = `${configPath}.agent-resume.tmp`;
        writeFileSync(temporary, next, { mode: 0o600 });
        renameSync(temporary, configPath);
        changed = true;
      }
    }
  }
  return { configPath, changed };
}

function codexStatus(ctx: AgentIntegrationContext): AgentIntegrationStatus {
  const configPath = codexConfigPath(ctx);
  const detected = existsSync(codexDir(ctx));
  const read = readJsonObject(codexHooksPath(ctx));
  const hooks = read.ok ? read.value.hooks : undefined;
  const installed = detected && read.ok && hooks && typeof hooks === "object" && !Array.isArray(hooks)
    ? countOurHooks(hooks as Record<string, unknown>, (command) =>
        isOurCommand(command, { panelHome: ctx.panelHome })
      ) >= CODEX_HOOKS.length
    : false;
  return {
    id: "codex",
    label: "Codex",
    detected,
    installed,
    detail: detected
      ? `${CODEX_HOOKS.length} lifecycle hooks in hooks.json + features.hooks`
      : "~/.codex not found; install codex first",
    configPath
  };
}

// ------------------------------------------------------------------------------ Pi

/**
 * Pi is auto-managed: the app writes its companion extension on startup, so the
 * settings row is a status, not a switch. Uninstalling it would only be undone at
 * the next launch, and pretending otherwise would be a lie in the UI.
 */
function piStatus(ctx: AgentIntegrationContext): AgentIntegrationStatus {
  const target = piExtensionPath(homeDir(ctx));
  const detected = existsSync(path.join(homeDir(ctx), ".pi", "agent"));
  const installed = piExtensionInstalled(homeDir(ctx));
  return {
    id: "pi",
    label: "Pi",
    detected,
    installed,
    detail: installed
      ? "companion extension reports status on the terminal stream (managed by the app)"
      : "extension is written when Desktop starts",
    configPath: target
  };
}

// -------------------------------------------------------------------------- registry

export function listAgentIntegrations(ctx: AgentIntegrationContext): AgentIntegrationStatus[] {
  return [claudeStatus(ctx), codexStatus(ctx), piStatus(ctx)];
}

export function installAgentIntegration(
  ctx: AgentIntegrationContext,
  id: AgentIntegrationId
): AgentIntegrationStatus {
  if (id === "claude") installClaudeHooks(ctx);
  else if (id === "codex") installCodexHooks(ctx);
  else installPiExtension(homeDir(ctx));
  return listAgentIntegrations(ctx).find((entry) => entry.id === id)!;
}

export function uninstallAgentIntegration(
  ctx: AgentIntegrationContext,
  id: AgentIntegrationId
): AgentIntegrationStatus {
  if (id === "claude") uninstallClaudeHooks(ctx);
  else if (id === "codex") uninstallCodexHooks(ctx);
  else {
    throw new Error("The Pi companion extension is managed by the app and is rewritten on startup.");
  }
  return listAgentIntegrations(ctx).find((entry) => entry.id === id)!;
}

export type { WrapperConfig };
