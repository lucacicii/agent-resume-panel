import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import * as fs from "node:fs";
import { Writable, Readable } from "node:stream";
import type { AgentCapabilities, ClientConnection, ClientContext } from "@agentclientprotocol/sdk" with { "resolution-mode": "import" };
import * as path from "node:path";
import { loadAcpAgentLaunch } from "./config";
import {
  AcpSessionModes,
  normalizeConfigOptionsArray,
  normalizeSessionConfigOptions
} from "./configNormalization";
import { createAcpClientApp } from "./createClientApp";
import { resolveExecutable, resolveSpawnCommand } from "./resolveCommand";

import { getAcpSdk } from "./sdk";
import type { AcpAgentProvider, AcpConfigOption } from "./types";

const STDERR_BUFFER_LIMIT = 2048;
const ACP_HANDSHAKE_TIMEOUT_MS = 60_000;

export {
  AcpSessionModes,
  normalizeConfigOptionsArray,
  normalizeSessionConfigOptions
};

export type RestoreSessionResult = {
  sessionId: string;
  modes: AcpSessionModes | null;
  configOptions: AcpConfigOption[];
  method: "resume" | "load" | "new";
};

export type AcpPromptBlock =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

export class AcpAgentConnection {
  private process?: ChildProcessWithoutNullStreams;
  private connection?: ClientConnection;
  private initialized = false;
  private agentCapabilities?: AgentCapabilities;
  private stderrBuffer = "";

  constructor(
    private readonly provider: AcpAgentProvider,
    private readonly projectPath?: string
  ) {}

  async connect(): Promise<ClientContext> {
    if (this.connection && this.initialized) {
      return this.connection.agent;
    }

    const acp = await getAcpSdk();
    const launch = loadAcpAgentLaunch(this.provider);
    // GUI-launched VS Code often lacks fnm/nvm/Homebrew on PATH → spawn ENOENT.
    const spawnSpec = resolveSpawnCommand(launch.command, process.env, launch.env);
    const command = spawnSpec.command;
    const env = spawnSpec.env;
    if (this.provider === "pi" && !env.PI_ACP_PI_COMMAND) {
      const piExecutable = resolveExecutable("pi", env.PATH || "");
      if (piExecutable) {
        env.PI_ACP_PI_COMMAND = piExecutable;
      }
    }
    const args = primeAgentLaunchArgs(this.provider, launch.args, this.projectPath);
    if (!spawnSpec.resolved && !path.isAbsolute(command) && !command.includes(path.sep)) {
      throw new Error(
        `Command not found: ${launch.command}. ` +
          `Install the agent CLI or set Settings → ACP → ${this.provider} command to an absolute path. ` +
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
                  `(command: ${command} ${args.join(" ")}). ` +
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
      if (spawnError) {
        throw this.wrapConnectError(spawnError, handshakeComplete, exitCode, exitSignal);
      }
      const exited = exitCode != null || exitSignal != null;
      if (exited) {
        throw this.wrapConnectError(error, handshakeComplete, exitCode, exitSignal);
      }
      await Promise.race([processExit, new Promise<void>((resolve) => setTimeout(resolve, 500))]);
      throw this.wrapConnectError(error, handshakeComplete, exitCode, exitSignal);
    } finally {
      if (handshakeTimer) {
        clearTimeout(handshakeTimer);
      }
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
    const baseMessage = error instanceof Error ? error.message : String(error);
    const details: string[] = [];

    if (!handshakeComplete) {
      details.push(`${this.provider} agent exited before ACP handshake`);
      if (exitSignal) {
        details.push(`signal ${exitSignal}`);
      } else if (exitCode != null) {
        details.push(`exit code ${exitCode}`);
      }
    }

    const stderr = this.stderrBuffer.trim();
    if (stderr) {
      details.push(stderr);
    }

    if (!details.length) {
      return error instanceof Error ? error : new Error(baseMessage);
    }

    return new Error(`${baseMessage}: ${details.join(" — ")}`);
  }

  async startSession(
    projectPath: string
  ): Promise<{ sessionId: string; modes: AcpSessionModes | null; configOptions: AcpConfigOption[] }> {
    const cwd = assertExistingDirectory(projectPath);
    const agent = await this.connect();
    const response = await agent.buildSession(cwd).start();
    const normalized = normalizeSessionConfigOptions(response.newSessionResponse as Record<string, unknown>);
    return {
      sessionId: response.sessionId,
      modes: normalized.modes,
      configOptions: normalized.configOptions
    };
  }

  async restoreSession(acpSessionId: string, projectPath: string): Promise<RestoreSessionResult> {
    const cwd = assertExistingDirectory(projectPath);
    const agent = await this.connect();
    const acp = await getAcpSdk();
    const params = { sessionId: acpSessionId, cwd, mcpServers: [] as [] };

    const restoreMethods: Array<"load" | "resume"> = [];
    if (this.agentCapabilities?.loadSession) {
      restoreMethods.push("load");
    }
    if (supportsSessionResume(this.agentCapabilities)) {
      restoreMethods.push("resume");
    }

    for (const method of restoreMethods) {
      try {
        const response = await agent.request(
          method === "load" ? acp.methods.agent.session.load : acp.methods.agent.session.resume,
          params
        );
        const normalized = normalizeSessionConfigOptions(response as Record<string, unknown>);
        return {
          sessionId: acpSessionId,
          modes: normalized.modes,
          configOptions: normalized.configOptions,
          method
        };
      } catch (error) {
        // Codex returns Internal error (-32603) for invalid/unknown session ids
        // rather than Resource not found — fall through to resume / session/new.
        console.warn(
          `[ACP ${this.provider}] session/${method} failed for ${acpSessionId}:`,
          error instanceof Error ? error.message : error
        );
      }
    }

    const response = await agent.buildSession(cwd).start();
    const normalized = normalizeSessionConfigOptions(response.newSessionResponse as Record<string, unknown>);
    return {
      sessionId: response.sessionId,
      modes: normalized.modes,
      configOptions: normalized.configOptions,
      method: "new"
    };
  }

  supportsImageUpload(): boolean {
    return this.agentCapabilities?.promptCapabilities?.image === true;
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
    value: string | boolean,
    valueType: "select" | "boolean" = "select"
  ): Promise<AcpConfigOption[] | null> {
    const agent = await this.connect();
    const acp = await getAcpSdk();
    const payload =
      valueType === "boolean"
        ? {
            sessionId: acpSessionId,
            configId,
            type: "boolean" as const,
            value: Boolean(value)
          }
        : {
            sessionId: acpSessionId,
            configId,
            value: String(value)
          };
    const response = await agent.request(acp.methods.agent.session.setConfigOption, payload);
    const rawOptions = (response as Record<string, unknown> | null | undefined)?.configOptions;
    if (!Array.isArray(rawOptions)) {
      return null;
    }
    return normalizeConfigOptionsArray(rawOptions);
  }

  async prompt(acpSessionId: string, blocks: AcpPromptBlock[]): Promise<{ stopReason: string }> {
    if (!blocks.length) {
      throw new Error("Prompt must include at least one content block.");
    }

    const hasImage = blocks.some((block) => block.type === "image");
    if (hasImage && !this.supportsImageUpload()) {
      throw new Error(`${this.provider} does not support image uploads.`);
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

function assertExistingDirectory(projectPath: string): string {
  const cwd = path.resolve(projectPath);
  let isDir = false;
  try {
    isDir = fs.existsSync(cwd) && fs.statSync(cwd).isDirectory();
  } catch {
    isDir = false;
  }
  if (!isDir) {
    throw new Error(`Project directory does not exist: ${cwd}`);
  }
  return cwd;
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
  const cwd = path.resolve(projectPath);
  if (args.some((arg) => arg === "--cwd" || arg.startsWith("--cwd="))) {
    return args;
  }
  return [...args, "--cwd", cwd];
}

function supportsSessionResume(capabilities?: AgentCapabilities): boolean {
  const resume = capabilities?.sessionCapabilities?.resume;
  return resume != null && typeof resume === "object";
}
