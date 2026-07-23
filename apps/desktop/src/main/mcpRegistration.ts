import { access, readFile, rename, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
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

async function executableOnPath(command: string | undefined): Promise<boolean> {
  if (!command) return false;
  const paths = (process.env.PATH || "").split(path.delimiter).filter(Boolean);
  for (const dir of paths) {
    try {
      await access(path.join(dir, command), constants.X_OK);
      return true;
    } catch {
      // keep looking
    }
  }
  return false;
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

export function createExternalMcpLaunchConfig(input: { executablePath: string; baseArgs?: string[]; panelHome: string }): McpLaunchConfig {
  return {
    command: input.executablePath,
    args: [...(input.baseArgs || []), "--agent-resume-mcp", EXTERNAL_MCP_SERVICE_ID],
    env: { AGENT_RESUME_PANEL_HOME: input.panelHome }
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

async function readJson(target: string): Promise<Record<string, unknown>> {
  try {
    const raw = await readFile(target, "utf8");
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Configuration root must be an object.");
    }
    return value as Record<string, unknown>;
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
  const config = await readJson(definition.configPath);
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
  const config = await readJson(definition.configPath);
  const rootKey = definition.id === "opencode" ? "mcp" : "mcpServers";
  const servers = asObject(config[rootKey]);
  if (!(EXTERNAL_MCP_SERVICE_ID in servers)) return;
  delete servers[EXTERNAL_MCP_SERVICE_ID];
  await writeJsonAtomically(definition.configPath, { ...config, [rootKey]: servers });
}

async function registerCliClient(definition: McpClientDefinition, launch: McpLaunchConfig, replace: boolean): Promise<void> {
  if (!definition.executable) throw new Error("MCP client executable is unavailable.");
  if (replace) {
    const removeArgs = definition.id === "claude"
      ? ["mcp", "remove", "--scope", "user", EXTERNAL_MCP_SERVICE_ID]
      : ["mcp", "remove", EXTERNAL_MCP_SERVICE_ID];
    await run(definition.executable, removeArgs).catch(() => {});
  }
  const envArgs = Object.entries(launch.env).flatMap(([key, value]) => ["--env", `${key}=${value}`]);
  const args = definition.id === "claude"
    ? ["mcp", "add", "--scope", "user", ...envArgs, EXTERNAL_MCP_SERVICE_ID, "--", launch.command, ...launch.args]
    : ["mcp", "add", ...envArgs, EXTERNAL_MCP_SERVICE_ID, "--", launch.command, ...launch.args];
  await run(definition.executable, args);
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
  if ((definition.id === "codex" || definition.id === "claude") && !(await executableOnPath(definition.executable))) {
    throw new Error(`${definition.label} was not found on this Mac.`);
  }
  if (definition.id === "codex" || definition.id === "claude") {
    await registerCliClient(definition, launch, replace);
  } else {
    await registerJsonClient(definition, launch, replace);
  }
}

export async function removeMcpClient(id: McpClientId): Promise<void> {
  const definition = definitionFor(id);
  if (definition.mode !== "automatic") return;
  if (definition.id === "codex" || definition.id === "claude") {
    if (!definition.executable || !(await executableOnPath(definition.executable))) {
      throw new Error(`${definition.label} executable was not found.`);
    }
    const args = definition.id === "claude"
      ? ["mcp", "remove", "--scope", "user", EXTERNAL_MCP_SERVICE_ID]
      : ["mcp", "remove", EXTERNAL_MCP_SERVICE_ID];
    await run(definition.executable, args);
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
