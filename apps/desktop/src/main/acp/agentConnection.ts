import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { Writable, Readable } from "node:stream";
import type { AgentCapabilities, ClientConnection, ClientContext } from "@agentclientprotocol/sdk" with {
  "resolution-mode": "import"
};
import * as path from "node:path";
import type { PanelSettings } from "@agent-resume/core";
import { resolveSpawnCommand } from "../processPath";
import { loadAcpAgentLaunch } from "./config";
import { createAcpClientApp } from "./createClientApp";
import { getAcpSdk } from "./sdk";
import type { AcpAgentProvider, AcpConfigOption, AcpConfigOptionCategory, AcpModelsState } from "./types";

const STDERR_BUFFER_LIMIT = 2048;
/** Fail the ACP initialize handshake if the agent never answers (avoids UI stuck on connecting). */
const ACP_HANDSHAKE_TIMEOUT_MS = 60_000;

export type AcpSessionModes = {
  currentModeId: string;
  availableModes: Array<{ id: string; name: string }>;
};

export type SessionMeta = {
  modes: AcpSessionModes | null;
  models: AcpModelsState | null;
  configOptions: AcpConfigOption[];
};

export type RestoreSessionResult = SessionMeta & {
  sessionId: string;
  method: "resume" | "load" | "new";
  /** Raw ACP response for experimental vendor adapters. */
  raw?: Record<string, unknown>;
};

export type StartSessionResult = SessionMeta & {
  sessionId: string;
  /** Raw ACP response for experimental vendor adapters. */
  raw?: Record<string, unknown>;
};

export type AcpPromptBlock =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string; uri?: string }
  | {
      type: "resource_link";
      uri: string;
      name: string;
      mimeType?: string;
      size?: number;
      title?: string;
    }
  | {
      type: "resource";
      resource:
        | { uri: string; text: string; mimeType?: string }
        | { uri: string; blob: string; mimeType?: string };
    };

export class AcpAgentConnection {
  private process?: ChildProcessWithoutNullStreams;
  private connection?: ClientConnection;
  private initialized = false;
  private agentCapabilities?: AgentCapabilities;
  private stderrBuffer = "";

  constructor(
    private readonly provider: AcpAgentProvider,
    private readonly settings: PanelSettings,
    private readonly projectPath?: string
  ) {}

  async connect(): Promise<ClientContext> {
    if (this.connection && this.initialized) {
      return this.connection.agent;
    }

    const acp = await getAcpSdk();
    const launch = loadAcpAgentLaunch(this.settings, this.provider);
    // GUI-launched Electron often lacks fnm/nvm/Homebrew on PATH → npx ENOENT.
    const spawnSpec = resolveSpawnCommand(launch.command, process.env, launch.env);
    const command = spawnSpec.command;
    const env = spawnSpec.env;
    const args = primeAgentLaunchArgs(this.provider, launch.args, this.projectPath);
    if (!spawnSpec.resolved && !path.isAbsolute(command) && !command.includes(path.sep)) {
      throw new Error(
        `Command not found: ${launch.command}. ` +
          `Install Node.js (so npx is available) or set Settings → ACP → ${this.provider} command to an absolute path. ` +
          `Searched PATH includes Homebrew/fnm/nvm common locations.`
      );
    }
    const useShell = process.platform === "win32" && (command.endsWith(".cmd") || command.endsWith(".bat"));
    this.stderrBuffer = "";
    this.process = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env,
      shell: useShell
    });

    let handshakeComplete = false;
    let exitCode: number | null = null;
    let exitSignal: NodeJS.Signals | null = null;
    let spawnError: Error | undefined;

    const processExit = new Promise<void>((resolve) => {
      this.process?.on("exit", (code, signal) => {
        exitCode = code;
        exitSignal = signal;
        this.initialized = false;
        resolve();
      });
    });

    this.process.on("error", (error) => {
      spawnError = error instanceof Error ? error : new Error(String(error));
      console.error(`[ACP ${this.provider}] spawn error`, spawnError);
    });

    this.process.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      this.stderrBuffer = (this.stderrBuffer + text).slice(-STDERR_BUFFER_LIMIT);
      console.error(`[ACP ${this.provider}]`, text);
    });

    const input = Writable.toWeb(this.process.stdin) as WritableStream<Uint8Array>;
    const output = Readable.toWeb(this.process.stdout) as ReadableStream<Uint8Array>;
    const stream = acp.ndJsonStream(input, output);
    const app = await createAcpClientApp();
    this.connection = app.connect(stream);

    let handshakeTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      const initResponse = await Promise.race([
        this.connection.agent.request(acp.methods.agent.initialize, {
          protocolVersion: acp.PROTOCOL_VERSION,
          clientCapabilities: {
            fs: { readTextFile: true, writeTextFile: true },
            terminal: true
          }
        }),
        new Promise<never>((_, reject) => {
          handshakeTimer = setTimeout(() => {
            reject(
              new Error(
                `ACP handshake timed out after ${Math.round(ACP_HANDSHAKE_TIMEOUT_MS / 1000)}s ` +
                  `(command: ${command} ${launch.args.join(" ")}). ` +
                  `Check that the agent CLI is installed and supports ACP stdio.`
              )
            );
          }, ACP_HANDSHAKE_TIMEOUT_MS);
        })
      ]);
      this.agentCapabilities = initResponse.agentCapabilities;
      handshakeComplete = true;
    } catch (error) {
      this.dispose();
      // Prefer spawn ENOENT etc. when the process never started.
      if (spawnError) {
        throw this.wrapConnectError(spawnError, handshakeComplete, exitCode, exitSignal);
      }
      // If the process already exited, surface that instead of a bare timeout.
      const exited = exitCode != null || exitSignal != null;
      if (exited) {
        throw this.wrapConnectError(error, handshakeComplete, exitCode, exitSignal);
      }
      // Best-effort wait so stderr has a chance to flush on crash paths.
      await Promise.race([processExit, new Promise<void>((r) => setTimeout(r, 500))]);
      throw this.wrapConnectError(error, handshakeComplete, exitCode, exitSignal);
    } finally {
      if (handshakeTimer) clearTimeout(handshakeTimer);
    }

    this.initialized = true;
    return this.connection.agent;
  }

  private wrapConnectError(
    error: unknown,
    handshakeComplete: boolean,
    exitCode: number | null,
    exitSignal: NodeJS.Signals | null
  ): Error {
    const baseMessage = formatAcpError(error);
    const details: string[] = [];
    if (!handshakeComplete) {
      details.push(`${this.provider} agent exited before ACP handshake`);
      if (exitSignal) details.push(`signal ${exitSignal}`);
      else if (exitCode != null) details.push(`exit code ${exitCode}`);
    }
    const stderr = this.stderrBuffer.trim();
    if (stderr) details.push(stderr);
    if (!details.length) {
      return new Error(baseMessage);
    }
    return new Error(`${baseMessage}: ${details.join(" — ")}`);
  }

  async startSession(projectPath: string): Promise<StartSessionResult> {
    const agent = await this.connect();
    const cwd = path.resolve(projectPath);
    const response = await agent.buildSession(cwd).start();
    const raw = (response.newSessionResponse || {}) as Record<string, unknown>;
    const meta = parseSessionMeta(raw);
    return {
      sessionId: response.sessionId,
      ...meta,
      raw
    };
  }

  async restoreSession(acpSessionId: string, projectPath: string): Promise<RestoreSessionResult> {
    const agent = await this.connect();
    const acp = await getAcpSdk();
    const cwd = path.resolve(projectPath);
    const params = { sessionId: acpSessionId, cwd, mcpServers: [] as [] };

    const restoreMethods: Array<"load" | "resume"> = [];
    if (this.agentCapabilities?.loadSession) restoreMethods.push("load");
    if (supportsSessionResume(this.agentCapabilities)) restoreMethods.push("resume");

    for (const method of restoreMethods) {
      try {
        const response = await agent.request(
          method === "load" ? acp.methods.agent.session.load : acp.methods.agent.session.resume,
          params
        );
        const raw = (response || {}) as Record<string, unknown>;
        return {
          sessionId: acpSessionId,
          ...parseSessionMeta(raw),
          method,
          raw
        };
      } catch (error) {
        // Codex often returns JSON-RPC -32603 "Internal error" with data.details
        // (e.g. invalid session id) instead of Resource not found. Always fall
        // through to the next restore method / a fresh session/new so reconnect
        // after adapter upgrades or stale ids does not hard-fail the UI.
        console.warn(
          `[ACP ${this.provider}] session/${method} failed for ${acpSessionId}: ${formatAcpError(error)}`
        );
      }
    }

    const response = await agent.buildSession(cwd).start();
    const raw = (response.newSessionResponse || {}) as Record<string, unknown>;
    return {
      sessionId: response.sessionId,
      ...parseSessionMeta(raw),
      method: "new",
      raw
    };
  }

  supportsImageUpload(): boolean {
    return this.agentCapabilities?.promptCapabilities?.image === true;
  }

  supportsEmbeddedContext(): boolean {
    return this.agentCapabilities?.promptCapabilities?.embeddedContext === true;
  }

  /** True when the ACP agent process is still up after a successful handshake. */
  isLive(): boolean {
    if (!this.connection || !this.initialized || !this.process) return false;
    if (this.process.killed) return false;
    if (this.process.exitCode != null) return false;
    return true;
  }

  async setMode(acpSessionId: string, modeId: string): Promise<void> {
    const agent = await this.connect();
    const acp = await getAcpSdk();
    await agent.request(acp.methods.agent.session.setMode, {
      sessionId: acpSessionId,
      modeId
    });
  }

  async setConfigOption(
    acpSessionId: string,
    configId: string,
    value: string | boolean
  ): Promise<AcpConfigOption[]> {
    const agent = await this.connect();
    const acp = await getAcpSdk();
    const response = await agent.request(acp.methods.agent.session.setConfigOption, {
      sessionId: acpSessionId,
      configId,
      value
    } as never);
    const options = (response as { configOptions?: unknown })?.configOptions;
    return parseConfigOptions(options);
  }

  /** Low-level request helper for experimental vendor methods (e.g. session/set_model). */
  async requestRaw(method: string, params: Record<string, unknown>): Promise<unknown> {
    const agent = await this.connect();
    return agent.request(method as never, params as never);
  }

  async prompt(acpSessionId: string, blocks: AcpPromptBlock[]): Promise<{ stopReason: string }> {
    if (!blocks.length) throw new Error("Prompt must include at least one content block.");
    const hasImage = blocks.some((block) => block.type === "image");
    if (hasImage && !this.supportsImageUpload()) {
      throw new Error(`${this.provider} does not support image uploads.`);
    }
    const hasEmbedded = blocks.some((block) => block.type === "resource");
    if (hasEmbedded && !this.supportsEmbeddedContext()) {
      throw new Error(`${this.provider} does not support embedded file context.`);
    }
    const agent = await this.connect();
    const acp = await getAcpSdk();
    return agent.request(acp.methods.agent.session.prompt, {
      sessionId: acpSessionId,
      prompt: blocks
    });
  }

  async cancel(acpSessionId: string): Promise<void> {
    const agent = await this.connect();
    const acp = await getAcpSdk();
    await agent.notify(acp.methods.agent.session.cancel, { sessionId: acpSessionId });
  }

  dispose(): void {
    if (this.connection) {
      this.connection.close();
      this.connection = undefined;
    }
    if (this.process) {
      this.process.kill();
      this.process = undefined;
    }
    this.initialized = false;
    this.agentCapabilities = undefined;
  }
}

function primeAgentLaunchArgs(
  provider: AcpAgentProvider,
  args: string[],
  projectPath?: string
): string[] {
  if (provider !== "prime") {
    return args;
  }
  if (!projectPath) {
    throw new Error("Prime Agent ACP requires a project working directory.");
  }
  if (args.some((arg) => arg === "--cwd" || arg.startsWith("--cwd="))) {
    return args;
  }
  return [...args, "--cwd", path.resolve(projectPath)];
}

function supportsSessionResume(capabilities?: AgentCapabilities): boolean {
  const resume = capabilities?.sessionCapabilities?.resume;
  return resume != null && typeof resume === "object";
}

/** Surface JSON-RPC RequestError data.details (Codex often hides the real reason there). */
export function formatAcpError(error: unknown): string {
  if (error == null) return "Unknown error";
  if (typeof error !== "object") return String(error);

  const message =
    error instanceof Error
      ? error.message
      : typeof (error as { message?: unknown }).message === "string"
        ? (error as { message: string }).message
        : String(error);

  const code =
    "code" in error && (typeof (error as { code: unknown }).code === "number" || typeof (error as { code: unknown }).code === "string")
      ? String((error as { code: number | string }).code)
      : undefined;

  let detail = "";
  if ("data" in error) {
    const data = (error as { data: unknown }).data;
    if (typeof data === "string") {
      detail = data;
    } else if (data && typeof data === "object") {
      const row = data as Record<string, unknown>;
      if (typeof row.details === "string") detail = row.details;
      else if (typeof row.message === "string") detail = row.message;
      else {
        try {
          detail = JSON.stringify(data);
        } catch {
          detail = "";
        }
      }
    }
  }

  const parts = [message];
  if (code) parts.push(`code ${code}`);
  if (detail && detail !== message) parts.push(detail);
  return parts.join(": ");
}

export function parseSessionMeta(response: Record<string, unknown> | null | undefined): SessionMeta {
  if (!response || typeof response !== "object") {
    return { modes: null, models: null, configOptions: [] };
  }
  return {
    modes: parseSessionModes(response.modes),
    models: parseSessionModels(response.models),
    configOptions: parseConfigOptions(response.configOptions)
  };
}

function parseSessionModes(value: unknown): AcpSessionModes | null {
  if (!value || typeof value !== "object") return null;
  const currentModeId = (value as { currentModeId?: string }).currentModeId;
  const availableModes = (value as { availableModes?: Array<{ id: string; name: string }> }).availableModes;
  if (currentModeId && availableModes?.length) {
    return {
      currentModeId,
      availableModes: availableModes
        .filter((entry) => entry && typeof entry.id === "string" && typeof entry.name === "string")
        .map((entry) => ({ id: entry.id, name: entry.name }))
    };
  }
  return null;
}

function parseSessionModels(value: unknown): AcpModelsState | null {
  if (!value || typeof value !== "object") return null;
  const currentModelId = (value as { currentModelId?: string }).currentModelId;
  const availableModels = (value as { availableModels?: Array<{ modelId: string; name: string }> })
    .availableModels;
  if (currentModelId && availableModels?.length) {
    return {
      currentModelId,
      availableModels: availableModels
        .filter((entry) => entry && typeof entry.modelId === "string" && typeof entry.name === "string")
        .map((entry) => ({ modelId: entry.modelId, name: entry.name }))
    };
  }
  return null;
}

export function parseConfigOptions(value: unknown): AcpConfigOption[] {
  if (!Array.isArray(value)) return [];
  const result: AcpConfigOption[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const entry = raw as Record<string, unknown>;
    const id = typeof entry.id === "string" ? entry.id : "";
    const name = typeof entry.name === "string" ? entry.name : id;
    if (!id) continue;
    const category =
      typeof entry.category === "string" ? (entry.category as AcpConfigOptionCategory) : undefined;
    if (entry.type === "boolean" || typeof entry.currentValue === "boolean") {
      result.push({
        type: "boolean",
        id,
        name,
        category,
        currentValue: Boolean(entry.currentValue)
      });
      continue;
    }
    // select (default)
    const currentValue =
      typeof entry.currentValue === "string"
        ? entry.currentValue
        : typeof entry.currentValue === "number"
          ? String(entry.currentValue)
          : "";
    const options = normalizeSelectOptions(entry.options);
    if (!options.length) continue;
    result.push({
      type: "select",
      id,
      name,
      category,
      currentValue: currentValue || firstSelectValue(options) || "",
      options
    });
  }
  return result;
}

function normalizeSelectOptions(
  value: unknown
): Array<{ value: string; name: string } | { group: string; name: string; options: Array<{ value: string; name: string }> }> {
  if (!Array.isArray(value)) return [];
  const out: Array<
    | { value: string; name: string }
    | { group: string; name: string; options: Array<{ value: string; name: string }> }
  > = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    if (typeof row.group === "string" && Array.isArray(row.options)) {
      const options = row.options
        .filter(
          (opt): opt is { value: string; name: string } =>
            Boolean(opt && typeof opt === "object" && typeof (opt as { value?: string }).value === "string")
        )
        .map((opt) => ({
          value: (opt as { value: string }).value,
          name:
            typeof (opt as { name?: string }).name === "string"
              ? (opt as { name: string }).name
              : (opt as { value: string }).value
        }));
      if (options.length) {
        out.push({
          group: row.group,
          name: typeof row.name === "string" ? row.name : row.group,
          options
        });
      }
      continue;
    }
    if (typeof row.value === "string") {
      out.push({
        value: row.value,
        name: typeof row.name === "string" ? row.name : row.value
      });
    }
  }
  return out;
}

function firstSelectValue(
  options: Array<{ value: string; name: string } | { group: string; name: string; options: Array<{ value: string; name: string }> }>
): string | undefined {
  for (const opt of options) {
    if ("value" in opt) return opt.value;
    if ("options" in opt && opt.options[0]) return opt.options[0].value;
  }
  return undefined;
}
