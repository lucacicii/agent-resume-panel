import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { Writable, Readable } from "node:stream";
import type { AgentCapabilities, ClientConnection, ClientContext } from "@agentclientprotocol/sdk" with { "resolution-mode": "import" };
import * as path from "node:path";
import { loadAcpAgentLaunch } from "./config";
import { createAcpClientApp } from "./createClientApp";
import { clearAllSessionUpdateListeners } from "./sessionUpdateBus";
import { getAcpSdk } from "./sdk";
import type { AcpAgentProvider } from "./types";

const STDERR_BUFFER_LIMIT = 2048;

export type AcpSessionModes = {
  currentModeId: string;
  availableModes: Array<{ id: string; name: string }>;
};

export type RestoreSessionResult = {
  sessionId: string;
  modes: AcpSessionModes | null;
  method: "resume" | "load" | "new";
};

export class AcpAgentConnection {
  private process?: ChildProcessWithoutNullStreams;
  private connection?: ClientConnection;
  private initialized = false;
  private agentCapabilities?: AgentCapabilities;
  private stderrBuffer = "";

  constructor(private readonly provider: AcpAgentProvider) {}

  async connect(): Promise<ClientContext> {
    if (this.connection && this.initialized) {
      return this.connection.agent;
    }

    const acp = await getAcpSdk();
    const launch = loadAcpAgentLaunch(this.provider);
    const env = { ...process.env, ...launch.env };
    const command = launch.command;
    const useShell = process.platform === "win32" && (command.endsWith(".cmd") || command.endsWith(".bat"));
    this.stderrBuffer = "";
    this.process = spawn(command, launch.args, {
      stdio: ["pipe", "pipe", "pipe"],
      env,
      shell: useShell
    });

    let handshakeComplete = false;
    let exitCode: number | null = null;
    let exitSignal: NodeJS.Signals | null = null;

    const processExit = new Promise<void>((resolve) => {
      this.process?.on("exit", (code, signal) => {
        exitCode = code;
        exitSignal = signal;
        resolve();
      });
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

    try {
      const initResponse = await this.connection.agent.request(acp.methods.agent.initialize, {
        protocolVersion: acp.PROTOCOL_VERSION,
        clientCapabilities: {
          fs: { readTextFile: true, writeTextFile: true },
          terminal: true
        }
      });
      this.agentCapabilities = initResponse.agentCapabilities;
      handshakeComplete = true;
    } catch (error) {
      await processExit;
      throw this.wrapConnectError(error, handshakeComplete, exitCode, exitSignal);
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

  async startSession(projectPath: string): Promise<{ sessionId: string; modes: AcpSessionModes | null }> {
    const agent = await this.connect();
    const cwd = path.resolve(projectPath);
    const response = await agent.buildSession(cwd).start();
    return {
      sessionId: response.sessionId,
      modes: normalizeSessionModes(response.newSessionResponse as Record<string, unknown>)
    };
  }

  async restoreSession(acpSessionId: string, projectPath: string): Promise<RestoreSessionResult> {
    const agent = await this.connect();
    const acp = await getAcpSdk();
    const cwd = path.resolve(projectPath);
    const params = { sessionId: acpSessionId, cwd, mcpServers: [] as [] };

    if (this.agentCapabilities?.sessionCapabilities?.resume) {
      const response = await agent.request(acp.methods.agent.session.resume, params);
      return {
        sessionId: acpSessionId,
        modes: normalizeSessionModes(response as Record<string, unknown>),
        method: "resume"
      };
    }

    if (this.agentCapabilities?.loadSession) {
      const response = await agent.request(acp.methods.agent.session.load, params);
      return {
        sessionId: acpSessionId,
        modes: normalizeSessionModes(response as Record<string, unknown>),
        method: "load"
      };
    }

    const response = await agent.buildSession(cwd).start();
    return {
      sessionId: response.sessionId,
      modes: normalizeSessionModes(response.newSessionResponse as Record<string, unknown>),
      method: "new"
    };
  }

  async setMode(acpSessionId: string, modeId: string): Promise<void> {
    const agent = await this.connect();
    const acp = await getAcpSdk();
    await agent.request(acp.methods.agent.session.setMode, {
      sessionId: acpSessionId,
      modeId
    });
  }

  async prompt(acpSessionId: string, text: string): Promise<{ stopReason: string }> {
    const agent = await this.connect();
    const acp = await getAcpSdk();
    return agent.request(acp.methods.agent.session.prompt, {
      sessionId: acpSessionId,
      prompt: [{ type: "text", text }]
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
    clearAllSessionUpdateListeners();
  }
}

function normalizeSessionModes(response: Record<string, unknown>): AcpSessionModes | null {
  const modes = response.modes;
  if (modes && typeof modes === "object") {
    const currentModeId = (modes as { currentModeId?: string }).currentModeId;
    const availableModes = (modes as { availableModes?: Array<{ id: string; name: string }> }).availableModes;
    if (currentModeId && availableModes?.length) {
      return { currentModeId, availableModes };
    }
  }

  const models = response.models;
  if (models && typeof models === "object") {
    const currentModelId = (models as { currentModelId?: string }).currentModelId;
    const availableModels = (models as { availableModels?: Array<{ modelId: string; name: string }> }).availableModels;
    if (currentModelId && availableModels?.length) {
      return {
        currentModeId: currentModelId,
        availableModes: availableModels.map((entry) => ({ id: entry.modelId, name: entry.name }))
      };
    }
  }

  return null;
}