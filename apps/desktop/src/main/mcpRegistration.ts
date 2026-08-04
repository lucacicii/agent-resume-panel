import { access, readFile, rename, writeFile } from "node:fs/promises";
import { constants, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import * as path from "node:path";
import { spawn } from "node:child_process";

export const EXTERNAL_MCP_SERVICE_ID = "agent-resume";
export const EXTERNAL_MCP_SERVICE_NAME = "Agent Resume";

export type McpClientId = "codex" | "claude" | "gemini" | "antigravity" | "opencode" | "cursor" | "pi" | "grok";
export type McpClientMode = "automatic" | "manual";

export interface McpLaunchConfig {
  command: string;
  args: string[];
  env: Record<string, string>;
}

export interface McpClientInfo {
  id: McpClientId;
  label: string;
  detected: boolean;
  registered: boolean;
  mode: McpClientMode;
  detail: string;
}

interface McpClientDefinition {
  id: McpClientId;
  label: string;
  mode: McpClientMode;
  executable?: string;
  configPath?: string;
  detectPath?: string;
  manualHome?: string;
}

const definitions: McpClientDefinition[] = [
  { id: "codex", label: "Codex", mode: "automatic", executable: "codex", configPath: path.join(homedir(), ".codex", "config.toml") },
  { id: "claude", label: "Claude Code", mode: "automatic", executable: "claude", configPath: path.join(homedir(), ".claude.json") },
  { id: "gemini", label: "Gemini CLI", mode: "automatic", executable: "gemini", configPath: path.join(homedir(), ".gemini", "settings.json"), detectPath: path.join(homedir(), ".gemini") },
  { id: "antigravity", label: "Antigravity", mode: "automatic", executable: "agy", configPath: path.join(homedir(), ".gemini", "config", "mcp_config.json"), detectPath: path.join(homedir(), ".gemini") },
  { id: "opencode", label: "OpenCode", mode: "automatic", executable: "opencode", configPath: path.join(homedir(), ".config", "opencode", "opencode.json"), detectPath: path.join(homedir(), ".local", "share", "opencode") },
  { id: "cursor", label: "Cursor", mode: "manual", manualHome: path.join(homedir(), ".cursor") },
  { id: "pi", label: "Pi", mode: "manual", manualHome: path.join(homedir(), ".pi", "agent") },
  { id: "grok", label: "Grok Build", mode: "manual", manualHome: path.join(homedir(), ".grok") }
];

function definitionFor(id: string): McpClientDefinition {
  const definition = definitions.find((item) => item.id === id);
  if (!definition) throw new Error("Unsupported MCP client.");
  return definition;
}

async function exists(target: string | undefined): Promise<boolean> {
  if (!target) return false;
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

const USER_EXECUTABLE_DIRS = [
  path.join(homedir(), ".local", "bin"),
  path.join(homedir(), ".volta", "bin"),
  path.join(homedir(), ".npm-global", "bin"),
  path.join(homedir(), ".cargo", "bin"),
  "/opt/homebrew/bin",
  "/usr/local/bin"
];

/**
 * Finder-launched Electron apps do not load the user's shell startup files,
 * so PATH often omits ~/.local/bin (where the standalone Codex CLI is commonly
 * installed). Search the inherited PATH plus stable user/system bin folders.
 */
export async function resolveExecutableOnPath(
  command: string | undefined,
  inheritedPath = process.env.PATH
): Promise<string | undefined> {
  if (!command?.trim()) return undefined;
  const requested = command.trim();
  if (path.isAbsolute(requested)) {
    try {
      await access(requested, constants.X_OK);
      return requested;
    } catch {
      return undefined;
    }
  }

  const directories = [...new Set([
    ...(inheritedPath || "").split(path.delimiter).filter(Boolean),
    ...USER_EXECUTABLE_DIRS
  ])];
  for (const dir of directories) {
    const candidate = path.join(dir, requested);
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // keep looking
    }
  }
  return undefined;
}

async function executableOnPath(command: string | undefined): Promise<boolean> {
  return Boolean(await resolveExecutableOnPath(command));
}

async function configContainsRegistration(configPath: string | undefined): Promise<boolean> {
  if (!configPath) return false;
  try {
    const content = await readFile(configPath, "utf8");
    return /agent-resume/.test(content);
  } catch {
    return false;
  }
}

/**
 * Resolve the pure Node MCP CLI (`@agent-resume/core` dist/mcp/cli.js).
 * Launch this with ELECTRON_RUN_AS_NODE so MCP clients do not spawn a Dock GUI.
 */
export function resolveExternalMcpCliPath(options: {
  isPackaged: boolean;
  resourcesPath: string;
  appPath: string;
}): string {
  const candidates: string[] = [];

  try {
    const require = createRequire(__filename);
    const coreMain = require.resolve("@agent-resume/core");
    candidates.push(path.join(path.dirname(coreMain), "mcp", "cli.js"));
  } catch {
    // fall through to filesystem candidates
  }

  if (options.isPackaged) {
    candidates.push(
      path.join(
        options.resourcesPath,
        "app.asar.unpacked",
        "node_modules",
        "@agent-resume",
        "core",
        "dist",
        "mcp",
        "cli.js"
      ),
      path.join(
        options.resourcesPath,
        "app.asar",
        "node_modules",
        "@agent-resume",
        "core",
        "dist",
        "mcp",
        "cli.js"
      ),
      path.join(
        options.appPath,
        "node_modules",
        "@agent-resume",
        "core",
        "dist",
        "mcp",
        "cli.js"
      )
    );
  } else {
    // monorepo: apps/desktop → packages/core
    candidates.push(
      path.join(options.appPath, "..", "..", "packages", "core", "dist", "mcp", "cli.js"),
      path.join(options.appPath, "node_modules", "@agent-resume", "core", "dist", "mcp", "cli.js")
    );
  }

  for (const candidate of candidates) {
    try {
      if (candidate && existsSync(candidate)) {
        return candidate;
      }
    } catch {
      // asar/odd FS errors — try next
    }
  }

  throw new Error(
    "Unable to resolve Agent Resume MCP CLI (packages/core dist/mcp/cli.js). Rebuild @agent-resume/core and Desktop."
  );
}

/**
 * MCP stdio launch descriptor: run pure Node CLI under Electron's Node mode.
 * Avoids a second Dock icon per MCP client (full Electron GUI was the old path).
 */
export function createExternalMcpLaunchConfig(input: {
  executablePath: string;
  cliPath: string;
  panelHome: string;
}): McpLaunchConfig {
  return {
    command: path.resolve(input.executablePath),
    args: [path.resolve(input.cliPath)],
    env: {
      ELECTRON_RUN_AS_NODE: "1",
      AGENT_RESUME_PANEL_HOME: input.panelHome
    }
  };
}

export async function listMcpClients(): Promise<McpClientInfo[]> {
  return Promise.all(definitions.map(async (definition) => {
    const executableDetected = await executableOnPath(definition.executable);
    const configDetected = await exists(definition.detectPath || definition.configPath || definition.manualHome);
    const registered = await configContainsRegistration(definition.configPath);
    return {
      id: definition.id,
      label: definition.label,
      detected: executableDetected || configDetected,
      registered,
      mode: definition.mode,
      detail: definition.mode === "automatic"
        ? definition.configPath || ""
        : "Copy the MCP configuration into this client's MCP settings."
    };
  }));
}

function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `${command} exited with code ${code ?? "unknown"}.`));
    });
  });
}

export function parseMcpJsonConfig(raw: string): Record<string, unknown> {
  const value = JSON.parse(raw) as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Configuration root must be an object.");
  }
  return value as Record<string, unknown>;
}

export async function readMcpJsonConfig(target: string): Promise<Record<string, unknown>> {
  try {
    const raw = await readFile(target, "utf8");
    if (!raw.trim()) {
      await writeJsonAtomically(target, {});
      return {};
    }
    return parseMcpJsonConfig(raw);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new Error(`Unable to read MCP configuration: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function writeJsonAtomically(target: string, value: Record<string, unknown>): Promise<void> {
  const directory = path.dirname(target);
  const { mkdir } = await import("node:fs/promises");
  await mkdir(directory, { recursive: true });
  const temporary = `${target}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, target);
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? { ...(value as Record<string, unknown>) } : {};
}

async function registerJsonClient(definition: McpClientDefinition, launch: McpLaunchConfig, replace: boolean): Promise<void> {
  if (!definition.configPath) throw new Error("MCP config path is unavailable.");
  const config = await readMcpJsonConfig(definition.configPath);
  const rootKey = definition.id === "opencode" ? "mcp" : "mcpServers";
  const servers = asObject(config[rootKey]);
  const existing = servers[EXTERNAL_MCP_SERVICE_ID];
  if (existing && !replace) {
    throw new Error(`${definition.label} already has an Agent Resume MCP entry. Use update to replace it.`);
  }
  servers[EXTERNAL_MCP_SERVICE_ID] = definition.id === "opencode"
    ? { type: "local", command: [launch.command, ...launch.args], environment: launch.env, enabled: true }
    : { command: launch.command, args: launch.args, env: launch.env };
  await writeJsonAtomically(definition.configPath, { ...config, [rootKey]: servers });
}

async function removeJsonClient(definition: McpClientDefinition): Promise<void> {
  if (!definition.configPath) return;
  const config = await readMcpJsonConfig(definition.configPath);
  const rootKey = definition.id === "opencode" ? "mcp" : "mcpServers";
  const servers = asObject(config[rootKey]);
  if (!(EXTERNAL_MCP_SERVICE_ID in servers)) return;
  delete servers[EXTERNAL_MCP_SERVICE_ID];
  await writeJsonAtomically(definition.configPath, { ...config, [rootKey]: servers });
}

async function registerCliClient(
  id: Extract<McpClientId, "codex" | "claude">,
  definition: McpClientDefinition,
  launch: McpLaunchConfig,
  replace: boolean
): Promise<void> {
  const executable = await resolveExecutableOnPath(definition.executable);
  if (!executable) {
    throw new Error(
      `${definition.label} was not found on this Mac. Checked PATH, ~/.local/bin, ~/.volta/bin, /opt/homebrew/bin, and /usr/local/bin.`
    );
  }
  if (replace) {
    const removeArgs = definition.id === "claude"
      ? ["mcp", "remove", "--scope", "user", EXTERNAL_MCP_SERVICE_ID]
      : ["mcp", "remove", EXTERNAL_MCP_SERVICE_ID];
    await run(executable, removeArgs).catch(() => {});
  }
  await run(executable, buildCliRegistrationArgs(id, launch));
}

/**
 * Codex accepts --env before the server name. Claude Code defines -e/--env as
 * a variadic option after <name>; placing it first makes it consume
 * `agent-resume` as another environment value. Keep the client-specific order.
 */
export function buildCliRegistrationArgs(
  id: Extract<McpClientId, "codex" | "claude">,
  launch: McpLaunchConfig
): string[] {
  if (id === "claude") {
    const envArgs = Object.entries(launch.env).flatMap(([key, value]) => ["-e", `${key}=${value}`]);
    return [
      "mcp",
      "add",
      "--scope",
      "user",
      EXTERNAL_MCP_SERVICE_ID,
      ...envArgs,
      "--",
      launch.command,
      ...launch.args
    ];
  }

  const envArgs = Object.entries(launch.env).flatMap(([key, value]) => ["--env", `${key}=${value}`]);
  return ["mcp", "add", ...envArgs, EXTERNAL_MCP_SERVICE_ID, "--", launch.command, ...launch.args];
}

export async function registerMcpClient(
  id: McpClientId,
  launch: McpLaunchConfig,
  replace = false
): Promise<void> {
  const definition = definitionFor(id);
  if (definition.mode !== "automatic") {
    throw new Error(`${definition.label} requires manual MCP configuration.`);
  }
  if ((definition.id === "codex" || definition.id === "claude") && !(await resolveExecutableOnPath(definition.executable))) {
    throw new Error(
      `${definition.label} was not found on this Mac. Checked PATH, ~/.local/bin, ~/.volta/bin, /opt/homebrew/bin, and /usr/local/bin.`
    );
  }
  if (definition.id === "codex" || definition.id === "claude") {
    await registerCliClient(definition.id, definition, launch, replace);
  } else {
    await registerJsonClient(definition, launch, replace);
  }
}

export async function removeMcpClient(id: McpClientId): Promise<void> {
  const definition = definitionFor(id);
  if (definition.mode !== "automatic") return;
  if (definition.id === "codex" || definition.id === "claude") {
    const executable = await resolveExecutableOnPath(definition.executable);
    if (!executable) {
      throw new Error(
        `${definition.label} executable was not found. Checked PATH, ~/.local/bin, ~/.volta/bin, /opt/homebrew/bin, and /usr/local/bin.`
      );
    }
    const args = definition.id === "claude"
      ? ["mcp", "remove", "--scope", "user", EXTERNAL_MCP_SERVICE_ID]
      : ["mcp", "remove", EXTERNAL_MCP_SERVICE_ID];
    await run(executable, args);
    return;
  }
  await removeJsonClient(definition);
}

export function manualMcpConfig(launch: McpLaunchConfig): string {
  return JSON.stringify({
    mcpServers: {
      [EXTERNAL_MCP_SERVICE_ID]: {
        command: launch.command,
        args: launch.args,
        env: launch.env
      }
    }
  }, null, 2);
}

/** True when a stored launch would start full GUI Electron (Dock spam). */
export function isLegacyAgentResumeLaunch(input: {
  command?: unknown;
  args?: unknown;
  env?: unknown;
  /** OpenCode stores `command` as string[] and `environment` instead of env. */
  environment?: unknown;
  type?: unknown;
}): boolean {
  const envRaw = (input.env && typeof input.env === "object" && !Array.isArray(input.env)
    ? input.env
    : input.environment && typeof input.environment === "object" && !Array.isArray(input.environment)
      ? input.environment
      : {}) as Record<string, unknown>;
  const nodeMode =
    envRaw.ELECTRON_RUN_AS_NODE === "1" ||
    envRaw.ELECTRON_RUN_AS_NODE === 1 ||
    envRaw.ELECTRON_RUN_AS_NODE === true;

  let args: string[] = [];
  if (Array.isArray(input.args)) {
    args = input.args.map(String);
  } else if (Array.isArray(input.command)) {
    // OpenCode local: command = [binary, ...args]
    args = input.command.slice(1).map(String);
  }

  if (args.some((a) => a === "--agent-resume-mcp" || a.includes("--agent-resume-mcp"))) {
    return true;
  }

  const hasHeadlessCli =
    args.length === 1 && /(?:^|[/\\])mcp[/\\]cli\.js$/.test(args[0]);
  if (hasHeadlessCli && nodeMode) {
    return false;
  }

  // Registered but missing Node mode / pure CLI → treat as legacy GUI Electron launch.
  if (args.length > 0 && !nodeMode) {
    return true;
  }
  if (args.length > 1 && !hasHeadlessCli) {
    return true;
  }
  return false;
}

function entryLooksLikeAgentResumeServer(entry: unknown): boolean {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
  const record = entry as Record<string, unknown>;
  if (Array.isArray(record.command)) {
    return record.command.map(String).join(" ").includes("agent-resume") ||
      record.command.map(String).some((c) => c.includes("mcp") && c.includes("cli"));
  }
  if (Array.isArray(record.args)) {
    return record.args.map(String).some((a) => a.includes("agent-resume") || a.includes("mcp/cli") || a.includes("mcp\\cli"));
  }
  return Boolean(record.command || record.args);
}

async function migrateJsonAgentResumeEntry(
  configPath: string,
  rootKey: string,
  launch: McpLaunchConfig,
  style: "standard" | "opencode"
): Promise<boolean> {
  if (!(await exists(configPath))) return false;
  const config = await readMcpJsonConfig(configPath);
  const servers = asObject(config[rootKey]);
  const existing = servers[EXTERNAL_MCP_SERVICE_ID];
  if (!existing) return false;
  if (!entryLooksLikeAgentResumeServer(existing) && typeof existing !== "object") return false;
  if (!isLegacyAgentResumeLaunch(asObject(existing))) return false;

  servers[EXTERNAL_MCP_SERVICE_ID] =
    style === "opencode"
      ? { type: "local", command: [launch.command, ...launch.args], environment: launch.env, enabled: true }
      : { command: launch.command, args: launch.args, env: launch.env };
  await writeJsonAtomically(configPath, { ...config, [rootKey]: servers });
  return true;
}

/**
 * Rewrite [mcp_servers.agent-resume] command/args/env in TOML configs (Codex, Grok).
 * Preserves unrelated keys (enabled, tools.*, startup_timeout_sec, …).
 */
export function migrateTomlAgentResumeSection(
  content: string,
  launch: McpLaunchConfig
): { content: string; changed: boolean } {
  if (!/\[mcp_servers\.agent-resume\]/.test(content)) {
    return { content, changed: false };
  }
  const blockMatch = content.match(
    /\[mcp_servers\.agent-resume\][\s\S]*?(?=\n\[(?!mcp_servers\.agent-resume(?:\.|$))|\s*$)/
  );
  const block = blockMatch?.[0] ?? "";
  const looksLegacy =
    block.includes("--agent-resume-mcp") ||
    !block.includes("ELECTRON_RUN_AS_NODE") ||
    !/mcp[/\\]cli\.js/.test(block);
  if (!looksLegacy) {
    return { content, changed: false };
  }

  let next = content;
  const commandLine = `command = ${JSON.stringify(launch.command)}`;
  const argsLine = `args = [${launch.args.map((a) => JSON.stringify(a)).join(", ")}]`;

  if (/^command\s*=/m.test(block)) {
    next = next.replace(
      /(\[mcp_servers\.agent-resume\](?:(?!\n\[)[\s\S])*?)^command\s*=\s*.+$/m,
      `$1${commandLine}`
    );
  } else {
    next = next.replace(/\[mcp_servers\.agent-resume\]\n?/, `[mcp_servers.agent-resume]\n${commandLine}\n`);
  }

  if (/^args\s*=/m.test(block)) {
    next = next.replace(
      /(\[mcp_servers\.agent-resume\](?:(?!\n\[)[\s\S])*?)^args\s*=\s*\[[\s\S]*?\]/m,
      `$1${argsLine}`
    );
  } else {
    next = next.replace(
      /(\[mcp_servers\.agent-resume\]\n(?:command\s*=\s*.+\n)?)/,
      `$1${argsLine}\n`
    );
  }

  if (/\[mcp_servers\.agent-resume\.env\]/.test(next)) {
    if (!/ELECTRON_RUN_AS_NODE\s*=/.test(next)) {
      next = next.replace(
        /\[mcp_servers\.agent-resume\.env\]\n/,
        `[mcp_servers.agent-resume.env]\nELECTRON_RUN_AS_NODE = "1"\n`
      );
    } else {
      next = next.replace(
        /ELECTRON_RUN_AS_NODE\s*=\s*.+/g,
        'ELECTRON_RUN_AS_NODE = "1"'
      );
    }
    if (/AGENT_RESUME_PANEL_HOME\s*=/.test(next)) {
      next = next.replace(
        /AGENT_RESUME_PANEL_HOME\s*=\s*.+/g,
        `AGENT_RESUME_PANEL_HOME = ${JSON.stringify(launch.env.AGENT_RESUME_PANEL_HOME)}`
      );
    } else {
      next = next.replace(
        /\[mcp_servers\.agent-resume\.env\]\n/,
        `[mcp_servers.agent-resume.env]\nAGENT_RESUME_PANEL_HOME = ${JSON.stringify(launch.env.AGENT_RESUME_PANEL_HOME)}\n`
      );
    }
  } else {
    const envBlock =
      `\n[mcp_servers.agent-resume.env]\n` +
      `ELECTRON_RUN_AS_NODE = "1"\n` +
      `AGENT_RESUME_PANEL_HOME = ${JSON.stringify(launch.env.AGENT_RESUME_PANEL_HOME)}\n`;
    // Insert env after the main agent-resume table (before next non-env subsection or end).
    next = next.replace(
      /(\[mcp_servers\.agent-resume\](?:(?!\n\[)[\s\S])*)/,
      `$1${envBlock}`
    );
  }

  return { content: next, changed: next !== content };
}

async function migrateTomlFile(configPath: string, launch: McpLaunchConfig): Promise<boolean> {
  if (!(await exists(configPath))) return false;
  const raw = await readFile(configPath, "utf8");
  const { content, changed } = migrateTomlAgentResumeSection(raw, launch);
  if (!changed) return false;
  const temporary = `${configPath}.${process.pid}.tmp`;
  await writeFile(temporary, content, "utf8");
  await rename(temporary, configPath);
  return true;
}

export interface McpMigrationResult {
  migrated: string[];
  failed: Array<{ target: string; error: string }>;
}

/**
 * Rewrite every known on-disk agent-resume MCP registration that still launches GUI Electron.
 * Safe: only touches the agent-resume entry / section.
 */
export async function migrateLegacyAgentResumeRegistrations(
  launch: McpLaunchConfig
): Promise<McpMigrationResult> {
  const migrated: string[] = [];
  const failed: Array<{ target: string; error: string }> = [];

  const jsonTargets: Array<{ label: string; path: string; rootKey: string; style: "standard" | "opencode" }> = [
    { label: "gemini", path: path.join(homedir(), ".gemini", "settings.json"), rootKey: "mcpServers", style: "standard" },
    {
      label: "antigravity",
      path: path.join(homedir(), ".gemini", "config", "mcp_config.json"),
      rootKey: "mcpServers",
      style: "standard"
    },
    {
      label: "opencode",
      path: path.join(homedir(), ".config", "opencode", "opencode.json"),
      rootKey: "mcp",
      style: "opencode"
    },
    { label: "cursor", path: path.join(homedir(), ".cursor", "mcp.json"), rootKey: "mcpServers", style: "standard" }
  ];

  for (const target of jsonTargets) {
    try {
      if (await migrateJsonAgentResumeEntry(target.path, target.rootKey, launch, target.style)) {
        migrated.push(target.label);
      }
    } catch (error) {
      failed.push({
        target: target.label,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  const tomlTargets = [
    { label: "codex", path: path.join(homedir(), ".codex", "config.toml") },
    { label: "grok", path: path.join(homedir(), ".grok", "config.toml") }
  ];
  for (const target of tomlTargets) {
    try {
      if (await migrateTomlFile(target.path, launch)) {
        migrated.push(target.label);
      }
    } catch (error) {
      failed.push({
        target: target.label,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  // Claude Code user scope via CLI when still legacy (config may be CLI-managed).
  try {
    if (await executableOnPath("claude")) {
      // Best-effort: re-register with replace when claude is present and json/user still has old entry.
      // Prefer reading common paths; if any mention --agent-resume-mcp, force replace.
      const claudeHome = path.join(homedir(), ".claude.json");
      let needsClaude = false;
      if (await exists(claudeHome)) {
        const raw = await readFile(claudeHome, "utf8");
        if (raw.includes("--agent-resume-mcp") || (raw.includes("agent-resume") && !raw.includes("ELECTRON_RUN_AS_NODE"))) {
          // Only if agent-resume server entry exists with legacy args — avoid false positive on project paths.
          if (/agent-resume[\s\S]{0,200}--agent-resume-mcp/.test(raw) || /"--agent-resume-mcp"/.test(raw)) {
            needsClaude = true;
          }
        }
      }
      if (needsClaude) {
        await registerMcpClient("claude", launch, true);
        migrated.push("claude");
      }
    }
  } catch (error) {
    failed.push({
      target: "claude",
      error: error instanceof Error ? error.message : String(error)
    });
  }

  return { migrated, failed };
}
