import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export type McpClientId =
  | "claude"
  | "codex"
  | "antigravity"
  | "cursor"
  | "opencode"
  | "grok"
  | "pi"
  | "prime"
  | "omp"
  | "vscode"
  | "gemini";

export type McpConfigFormat =
  | "json-mcpServers"
  | "json-vscode-servers"
  | "json-opencode"
  | "toml-mcp_servers";

export interface McpLaunchSpec {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface McpClientDefinition {
  id: McpClientId;
  label: string;
  configPath: string;
  detectPaths: string[];
  format: McpConfigFormat;
}

export interface DetectedMcpClient extends McpClientDefinition {
  installed: boolean;
  registered: boolean;
}

export interface McpDetectEnvironment {
  homeDir?: string;
  platform?: NodeJS.Platform;
  appDataDir?: string;
  xdgConfigHome?: string;
}

export const MCP_SERVER_KEY = "agent-resume";

function vscodeUserDir(homeDir: string, platform: NodeJS.Platform, appDataDir?: string): string {
  if (platform === "darwin") {
    return path.join(homeDir, "Library", "Application Support", "Code", "User");
  }
  if (platform === "win32") {
    const appData = appDataDir || process.env.APPDATA || path.join(homeDir, "AppData", "Roaming");
    return path.join(appData, "Code", "User");
  }
  return path.join(homeDir, ".config", "Code", "User");
}

function resolveOpenCodeConfigPath(homeDir: string, xdgConfigHome?: string): {
  configPath: string;
  detectPaths: string[];
} {
  const xdg = xdgConfigHome || process.env.XDG_CONFIG_HOME || path.join(homeDir, ".config");
  const configDir = path.join(xdg, "opencode");
  const jsonPath = path.join(configDir, "opencode.json");
  return {
    configPath: jsonPath,
    detectPaths: [configDir, path.join(homeDir, ".local", "share", "opencode")]
  };
}

function resolveAntigravityConfigPath(homeDir: string): {
  configPath: string;
  detectPaths: string[];
} {
  const primary = path.join(homeDir, ".gemini", "config", "mcp_config.json");
  const legacy = path.join(homeDir, ".gemini", "antigravity", "mcp_config.json");
  const configPath = !fs.existsSync(primary) && fs.existsSync(legacy) ? legacy : primary;
  return {
    configPath,
    detectPaths: [
      path.join(homeDir, ".gemini", "antigravity-cli"),
      path.join(homeDir, ".gemini", "antigravity"),
      path.join(homeDir, ".gemini", "config")
    ]
  };
}

export function getMcpClientDefinitions(env: McpDetectEnvironment = {}): McpClientDefinition[] {
  const homeDir = env.homeDir || os.homedir();
  const platform = env.platform || process.platform;
  const vscodeUser = vscodeUserDir(homeDir, platform, env.appDataDir);
  const openCode = resolveOpenCodeConfigPath(homeDir, env.xdgConfigHome);
  const antigravity = resolveAntigravityConfigPath(homeDir);

  return [
    {
      id: "claude",
      label: "Claude Code",
      configPath: path.join(homeDir, ".claude.json"),
      detectPaths: [path.join(homeDir, ".claude.json"), path.join(homeDir, ".claude")],
      format: "json-mcpServers"
    },
    {
      id: "codex",
      label: "Codex CLI",
      configPath: path.join(homeDir, ".codex", "config.toml"),
      detectPaths: [path.join(homeDir, ".codex")],
      format: "toml-mcp_servers"
    },
    {
      id: "antigravity",
      label: "Antigravity",
      configPath: antigravity.configPath,
      detectPaths: antigravity.detectPaths,
      format: "json-mcpServers"
    },
    {
      id: "cursor",
      label: "Cursor",
      configPath: path.join(homeDir, ".cursor", "mcp.json"),
      detectPaths: [path.join(homeDir, ".cursor")],
      format: "json-mcpServers"
    },
    {
      id: "opencode",
      label: "OpenCode",
      configPath: openCode.configPath,
      detectPaths: openCode.detectPaths,
      format: "json-opencode"
    },
    {
      id: "grok",
      label: "Grok Build",
      configPath: path.join(homeDir, ".grok", "config.toml"),
      detectPaths: [path.join(homeDir, ".grok")],
      format: "toml-mcp_servers"
    },
    {
      id: "pi",
      label: "Pi",
      configPath: path.join(homeDir, ".pi", "agent", "mcp.json"),
      detectPaths: [path.join(homeDir, ".pi", "agent")],
      format: "json-mcpServers"
    },
    {
      id: "prime",
      label: "Prime Agent",
      configPath: path.join(homeDir, ".prime", "agent", "settings.json"),
      detectPaths: [path.join(homeDir, ".prime", "agent")],
      format: "json-mcpServers"
    },
    {
      id: "omp",
      label: "OMP",
      configPath: path.join(homeDir, ".omp", "agent", "mcp.json"),
      detectPaths: [path.join(homeDir, ".omp", "agent")],
      format: "json-mcpServers"
    },
    {
      id: "vscode",
      label: "VS Code (User mcp.json)",
      configPath: path.join(vscodeUser, "mcp.json"),
      detectPaths: [vscodeUser],
      format: "json-vscode-servers"
    },
    {
      id: "gemini",
      label: "Gemini CLI",
      configPath: path.join(homeDir, ".gemini", "settings.json"),
      detectPaths: [path.join(homeDir, ".gemini", "settings.json")],
      format: "json-mcpServers"
    }
  ];
}

function readOptionalFile(filePath: string): string | undefined {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return undefined;
  }
}

function parseJsonObjectSafe(raw: string, filePath: string): Record<string, unknown> {
  const trimmed = raw.trim();
  if (!trimmed) {
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid JSON in ${filePath}: ${msg}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Expected JSON object in ${filePath}`);
  }
  return parsed as Record<string, unknown>;
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function tomlSectionMatchesServer(headerLine: string, serverKey: string): boolean {
  const trimmed = headerLine.trim();
  if (!trimmed.startsWith("[") || trimmed.startsWith("[[")) {
    return false;
  }
  const closeIdx = trimmed.indexOf("]");
  if (closeIdx < 0) {
    return false;
  }
  const body = trimmed.slice(1, closeIdx).trim();
  return (
    body === `mcp_servers.${serverKey}` ||
    body === `mcp_servers."${serverKey}"` ||
    body.startsWith(`mcp_servers.${serverKey}.`) ||
    body.startsWith(`mcp_servers."${serverKey}".`)
  );
}

export function hasTomlMcpServer(raw: string, serverKey: string = MCP_SERVER_KEY): boolean {
  return raw
    .split(/\r?\n/)
    .some((line) => tomlSectionMatchesServer(line, serverKey));
}

export function removeTomlMcpServer(raw: string, serverKey: string = MCP_SERVER_KEY): string {
  const lines = raw.split(/\r?\n/);
  const kept: string[] = [];
  let skipping = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("[")) {
      if (tomlSectionMatchesServer(trimmed, serverKey)) {
        skipping = true;
        continue;
      }
      skipping = false;
    }
    if (!skipping) {
      kept.push(line);
    }
  }

  return `${kept.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd()}\n`;
}

export function buildTomlMcpBlock(spec: McpLaunchSpec, serverKey: string = MCP_SERVER_KEY): string {
  const lines: string[] = [
    `[mcp_servers.${serverKey}]`,
    `command = ${tomlString(spec.command)}`
  ];
  if (spec.args.length > 0) {
    lines.push(`args = [${spec.args.map(tomlString).join(", ")}]`);
  }
  if (spec.env && Object.keys(spec.env).length > 0) {
    lines.push("");
    lines.push(`[mcp_servers.${serverKey}.env]`);
    for (const [k, v] of Object.entries(spec.env)) {
      lines.push(`${k} = ${tomlString(v)}`);
    }
  }
  return lines.join("\n");
}

export function upsertTomlMcpServer(
  raw: string,
  spec: McpLaunchSpec,
  serverKey: string = MCP_SERVER_KEY
): string {
  const withoutExisting = removeTomlMcpServer(raw, serverKey).trimEnd();
  const block = buildTomlMcpBlock(spec, serverKey);
  if (!withoutExisting) {
    return `${block}\n`;
  }
  return `${withoutExisting}\n\n${block}\n`;
}

function jsonContainerKey(format: McpConfigFormat): "servers" | "mcp" | "mcpServers" {
  if (format === "json-vscode-servers") {
    return "servers";
  }
  if (format === "json-opencode") {
    return "mcp";
  }
  return "mcpServers";
}

export function readRegisteredMcpSpec(def: McpClientDefinition): McpLaunchSpec | undefined {
  const raw = readOptionalFile(def.configPath);
  if (!raw) {
    return undefined;
  }
  if (def.format === "toml-mcp_servers") {
    if (!hasTomlMcpServer(raw, MCP_SERVER_KEY)) {
      return undefined;
    }
    const lines = raw.split(/\r?\n/);
    let section: "none" | "main" | "env" = "none";
    let command = "";
    let args: string[] = [];
    const env: Record<string, string> = {};

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }
      if (trimmed.startsWith("[")) {
        if (
          trimmed === `[mcp_servers.${MCP_SERVER_KEY}]` ||
          trimmed === `[mcp_servers."${MCP_SERVER_KEY}"]`
        ) {
          section = "main";
        } else if (
          trimmed === `[mcp_servers.${MCP_SERVER_KEY}.env]` ||
          trimmed === `[mcp_servers."${MCP_SERVER_KEY}".env]`
        ) {
          section = "env";
        } else {
          section = "none";
        }
        continue;
      }
      const eq = trimmed.indexOf("=");
      if (eq < 0 || section === "none") {
        continue;
      }
      const key = trimmed.slice(0, eq).trim();
      const valRaw = trimmed.slice(eq + 1).trim();
      try {
        const parsed = JSON.parse(valRaw) as unknown;
        if (section === "main") {
          if (key === "command" && typeof parsed === "string") {
            command = parsed;
          } else if (key === "args" && Array.isArray(parsed)) {
            args = parsed.filter((v): v is string => typeof v === "string");
          }
        } else if (section === "env" && typeof parsed === "string") {
          env[key] = parsed;
        }
      } catch {
        // ignore unparseable TOML value
      }
    }

    return command
      ? { command, args, ...(Object.keys(env).length > 0 ? { env } : {}) }
      : undefined;
  }

  try {
    const root = parseJsonObjectSafe(raw, def.configPath);
    const containerKey = jsonContainerKey(def.format);
    const container = root[containerKey];
    if (!container || typeof container !== "object" || Array.isArray(container)) {
      return undefined;
    }
    const entry = (container as Record<string, unknown>)[MCP_SERVER_KEY];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return undefined;
    }
    const rec = entry as Record<string, unknown>;
    if (def.format === "json-opencode") {
      if (!Array.isArray(rec.command) || rec.command.length === 0) {
        return undefined;
      }
      const [cmd, ...rest] = rec.command.filter((v): v is string => typeof v === "string");
      if (!cmd) {
        return undefined;
      }
      const envObj =
        rec.environment && typeof rec.environment === "object" && !Array.isArray(rec.environment)
          ? (rec.environment as Record<string, string>)
          : undefined;
      return { command: cmd, args: rest, ...(envObj ? { env: envObj } : {}) };
    }
    if (typeof rec.command !== "string" || !rec.command.trim()) {
      return undefined;
    }
    const args = Array.isArray(rec.args)
      ? rec.args.filter((v): v is string => typeof v === "string")
      : [];
    const envObj =
      rec.env && typeof rec.env === "object" && !Array.isArray(rec.env)
        ? (rec.env as Record<string, string>)
        : undefined;
    return { command: rec.command, args, ...(envObj ? { env: envObj } : {}) };
  } catch {
    return undefined;
  }
}

export function isMcpClientRegistered(def: McpClientDefinition): boolean {
  const raw = readOptionalFile(def.configPath);
  if (!raw) {
    return false;
  }
  if (def.format === "toml-mcp_servers") {
    return hasTomlMcpServer(raw, MCP_SERVER_KEY);
  }
  try {
    const root = parseJsonObjectSafe(raw, def.configPath);
    const containerKey = jsonContainerKey(def.format);
    const container = root[containerKey];
    return Boolean(
      container &&
        typeof container === "object" &&
        !Array.isArray(container) &&
        MCP_SERVER_KEY in (container as Record<string, unknown>)
    );
  } catch {
    return false;
  }
}

export function detectMcpClients(env: McpDetectEnvironment = {}): DetectedMcpClient[] {
  return getMcpClientDefinitions(env).map((def) => {
    const installed = def.detectPaths.some((p) => fs.existsSync(p));
    const registered = isMcpClientRegistered(def);
    return {
      ...def,
      installed,
      registered
    };
  });
}

function jsonServerEntry(spec: McpLaunchSpec, format: McpConfigFormat): Record<string, unknown> {
  if (format === "json-opencode") {
    const entry: Record<string, unknown> = {
      type: "local",
      command: [spec.command, ...spec.args],
      enabled: true
    };
    if (spec.env && Object.keys(spec.env).length > 0) {
      entry.environment = spec.env;
    }
    return entry;
  }

  const entry: Record<string, unknown> =
    format === "json-vscode-servers"
      ? {
          type: "stdio",
          command: spec.command,
          args: spec.args
        }
      : {
          command: spec.command,
          args: spec.args
        };
  if (spec.env && Object.keys(spec.env).length > 0) {
    entry.env = spec.env;
  }
  return entry;
}

export function upsertMcpClientConfig(def: McpClientDefinition, spec: McpLaunchSpec): void {
  fs.mkdirSync(path.dirname(def.configPath), { recursive: true });
  const existingRaw = readOptionalFile(def.configPath) ?? "";

  if (def.format === "toml-mcp_servers") {
    const next = upsertTomlMcpServer(existingRaw, spec, MCP_SERVER_KEY);
    fs.writeFileSync(def.configPath, next, "utf8");
    return;
  }

  const root = parseJsonObjectSafe(existingRaw, def.configPath);
  const containerKey = jsonContainerKey(def.format);
  const existingContainer = root[containerKey];
  if (
    existingContainer !== undefined &&
    (typeof existingContainer !== "object" || existingContainer === null || Array.isArray(existingContainer))
  ) {
    throw new Error(`Expected "${containerKey}" to be a JSON object in ${def.configPath}`);
  }
  const container = { ...((existingContainer as Record<string, unknown>) ?? {}) };
  container[MCP_SERVER_KEY] = jsonServerEntry(spec, def.format);
  root[containerKey] = container;
  fs.writeFileSync(def.configPath, `${JSON.stringify(root, null, 2)}\n`, "utf8");
}

export function removeMcpClientConfig(def: McpClientDefinition): boolean {
  const existingRaw = readOptionalFile(def.configPath);
  if (existingRaw === undefined) {
    return false;
  }

  if (def.format === "toml-mcp_servers") {
    if (!hasTomlMcpServer(existingRaw, MCP_SERVER_KEY)) {
      return false;
    }
    const next = removeTomlMcpServer(existingRaw, MCP_SERVER_KEY);
    fs.writeFileSync(def.configPath, next, "utf8");
    return true;
  }

  const root = parseJsonObjectSafe(existingRaw, def.configPath);
  const containerKey = jsonContainerKey(def.format);
  const existingContainer = root[containerKey];
  if (!existingContainer || typeof existingContainer !== "object" || Array.isArray(existingContainer)) {
    return false;
  }
  const container = { ...(existingContainer as Record<string, unknown>) };
  if (!(MCP_SERVER_KEY in container)) {
    return false;
  }
  delete container[MCP_SERVER_KEY];
  root[containerKey] = container;
  fs.writeFileSync(def.configPath, `${JSON.stringify(root, null, 2)}\n`, "utf8");
  return true;
}

export function buildMcpConfigSnippet(spec: McpLaunchSpec): string {
  const mcpServersJson = JSON.stringify(
    {
      mcpServers: {
        [MCP_SERVER_KEY]: jsonServerEntry(spec, "json-mcpServers")
      }
    },
    null,
    2
  );
  const vscodeJson = JSON.stringify(
    {
      servers: {
        [MCP_SERVER_KEY]: jsonServerEntry(spec, "json-vscode-servers")
      }
    },
    null,
    2
  );
  const opencodeJson = JSON.stringify(
    {
      mcp: {
        [MCP_SERVER_KEY]: jsonServerEntry(spec, "json-opencode")
      }
    },
    null,
    2
  );
  const tomlBlock = buildTomlMcpBlock(spec, MCP_SERVER_KEY);

  return [
    "// Claude Code / Antigravity / Cursor / Pi / Prime Agent / OMP / Gemini CLI",
    mcpServersJson,
    "",
    "// OpenCode (~/.config/opencode/opencode.json)",
    opencodeJson,
    "",
    "// VS Code (User mcp.json)",
    vscodeJson,
    "",
    "# Codex CLI (~/.codex/config.toml) / Grok Build (~/.grok/config.toml)",
    tomlBlock
  ].join("\n");
}

export function buildAgentSelfInstallPrompt(
  spec: McpLaunchSpec,
  env: McpDetectEnvironment = {}
): string {
  const clients = getMcpClientDefinitions(env);
  const standardJsonEntry = JSON.stringify(jsonServerEntry(spec, "json-mcpServers"), null, 2);
  const openCodeEntry = JSON.stringify(jsonServerEntry(spec, "json-opencode"), null, 2);
  const vscodeEntry = JSON.stringify(jsonServerEntry(spec, "json-vscode-servers"), null, 2);
  const tomlBlock = buildTomlMcpBlock(spec, MCP_SERVER_KEY);

  const pathList = clients
    .map((c) => `- ${c.label}: \`${c.configPath}\` (${c.format})`)
    .join("\n");

  return [
    "Please configure the local `agent-resume` MCP server for yourself (and any other coding agents you manage if requested) so you can query my Agent Resume Panel notes, tasks, and indexed sessions.",
    "",
    "### 1. Server Runtime & Verification",
    `- Launch command: \`${spec.command}\``,
    `- Launch args: \`${JSON.stringify(spec.args)}\``,
    ...(spec.env && Object.keys(spec.env).length > 0
      ? [`- Environment variables: \`${JSON.stringify(spec.env)}\``]
      : []),
    `- Quick sanity check: run \`"${spec.command}" ${spec.args.map((a) => `"${a}"`).join(" ")} --version\` (should print a version without error; requires Node.js >= 22.13).`,
    "",
    "### 2. Config Paths by Agent",
    pathList,
    "",
    "### 3. Exact Config Formats (Preserve All Existing Settings!)",
    "1. **Standard `mcpServers` JSON** (Claude Code, Antigravity, Cursor, Pi, Prime Agent, OMP, Gemini CLI):",
    "   Add under top-level `\"mcpServers\"` with key `\"agent-resume\"`:",
    "```json",
    standardJsonEntry,
    "```",
    "2. **OpenCode** (`opencode.json`):",
    "   Add under top-level `\"mcp\"` with key `\"agent-resume\"`:",
    "```json",
    openCodeEntry,
    "```",
    "3. **VS Code** (User `mcp.json`):",
    "   Add under top-level `\"servers\"` with key `\"agent-resume\"`:",
    "```json",
    vscodeEntry,
    "```",
    "4. **Codex CLI / Grok Build** (`config.toml`):",
    "   Add or update these TOML sections:",
    "```toml",
    tomlBlock,
    "```",
    "",
    "### 4. Instructions",
    "1. Detect which agent/CLI you are currently running in, read its existing config file (create parent directory and file if missing), and merge the `agent-resume` entry without removing or overwriting existing servers or settings.",
    "2. Report the config file path you updated and remind me if I need to restart or reload the session for the new MCP tools (`search_agent_resume`, `list_notes`, `read_note`, `list_sessions`, `get_session`, `list_projects`) to appear."
  ].join("\n");
}
