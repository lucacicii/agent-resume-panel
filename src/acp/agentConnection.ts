import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { Writable, Readable } from "node:stream";
import type { ClientConnection, ClientContext } from "@agentclientprotocol/sdk" with { "resolution-mode": "import" };
import * as path from "node:path";
import { loadAcpAgentLaunch } from "./config";
import { createAcpClientApp } from "./createClientApp";
import { clearAllSessionUpdateListeners } from "./sessionUpdateBus";
import { getAcpSdk } from "./sdk";
import type { AcpAgentProvider } from "./types";

export class AcpAgentConnection {
  private process?: ChildProcessWithoutNullStreams;
  private connection?: ClientConnection;
  private initialized = false;

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
    this.process = spawn(command, launch.args, {
      stdio: ["pipe", "pipe", "pipe"],
      env,
      shell: useShell
    });

    this.process.stderr.on("data", (chunk: Buffer) => {
      console.error(`[ACP ${this.provider}]`, chunk.toString());
    });

    const input = Writable.toWeb(this.process.stdin) as WritableStream<Uint8Array>;
    const output = Readable.toWeb(this.process.stdout) as ReadableStream<Uint8Array>;
    const stream = acp.ndJsonStream(input, output);
    const app = await createAcpClientApp();
    this.connection = app.connect(stream);

    await this.connection.agent.request(acp.methods.agent.initialize, {
      protocolVersion: acp.PROTOCOL_VERSION,
      clientCapabilities: {
        fs: { readTextFile: true, writeTextFile: true },
        terminal: true
      }
    });

    this.initialized = true;
    return this.connection.agent;
  }

  async startSession(projectPath: string): Promise<{ sessionId: string; modes?: { currentModeId: string; availableModes: Array<{ id: string; name: string }> } | null }> {
    const agent = await this.connect();
    const cwd = path.resolve(projectPath);
    const response = await agent.buildSession(cwd).start();
    return { sessionId: response.sessionId, modes: response.modes ?? null };
  }

  async resumeSession(acpSessionId: string, projectPath: string): Promise<{ modes?: { currentModeId: string; availableModes: Array<{ id: string; name: string }> } | null }> {
    const agent = await this.connect();
    const acp = await getAcpSdk();
    const response = await agent.request(acp.methods.agent.session.resume, {
      sessionId: acpSessionId,
      cwd: path.resolve(projectPath),
      mcpServers: []
    });
    return { modes: response.modes ?? null };
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
    clearAllSessionUpdateListeners();
  }
}