import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as readline from "node:readline";
import { randomUUID } from "node:crypto";
import { loadSettings } from "@agent-resume/core";
import { buildAugmentedPath } from "../processPath";
import type {
  ThunderDaemonIncoming,
  ThunderModelInfo,
  ThunderObservedEvent,
  ThunderConversationSummary,
  ThunderConversation,
  ThunderTaskTrace,
  ThunderTitleResult
} from "./thunderProtocol";

interface PendingRequest {
  resolve: (data: any) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

/** Normalize a rejected daemon command into a structured title error result. */
function titleErrorResult(err: unknown): ThunderTitleResult {
  const message = err instanceof Error ? err.message : String(err);
  const kindMatch = /^\[(\w+)\]\s*/.exec(message);
  return { ok: false, errorKind: kindMatch?.[1] || "unknown", error: message };
}

interface ActiveTask {
  onEvent?: (event: ThunderObservedEvent) => void;
  resolve: (result: { finalContent?: string; finishReason: string; activePlugins?: string[] }) => void;
  reject: (err: Error) => void;
}

export class ThunderClient {
  private child: ChildProcess | null = null;
  private rl: readline.Interface | null = null;
  private pendingRequests = new Map<string, PendingRequest>();
  private activeTasks = new Map<string, ActiveTask>();
  private startingPromise: Promise<void> | null = null;

  /**
   * Search candidate paths to locate the Thunder repository or daemon binary.
   */
  public resolveDaemon(): {
    repoPath: string | null;
    binaryPath: string | null;
    scriptPath: string | null;
  } {
    const candidates: string[] = [];

    if (process.env.THUNDER_DAEMON_BIN && fs.existsSync(process.env.THUNDER_DAEMON_BIN)) {
      return {
        repoPath: path.dirname(path.dirname(path.dirname(process.env.THUNDER_DAEMON_BIN))),
        binaryPath: process.env.THUNDER_DAEMON_BIN,
        scriptPath: null
      };
    }

    if (process.env.THUNDER_PATH) {
      candidates.push(process.env.THUNDER_PATH);
    }

    candidates.push(
      "/Users/lucas/wz/GitHub/thunder",
      path.resolve(__dirname, "../../../../../thunder"),
      path.resolve(process.cwd(), "../thunder"),
      path.join(os.homedir(), "wz/GitHub/thunder"),
      path.join(os.homedir(), "GitHub/thunder")
    );

    for (const repo of candidates) {
      if (!fs.existsSync(repo)) continue;

      const releaseBin = path.join(repo, "thunder-agent-daemon/target/release/thunder-daemon");
      if (fs.existsSync(releaseBin)) {
        return { repoPath: repo, binaryPath: releaseBin, scriptPath: path.join(repo, "daemon.sh") };
      }

      const debugBin = path.join(repo, "thunder-agent-daemon/target/debug/thunder-daemon");
      if (fs.existsSync(debugBin)) {
        return { repoPath: repo, binaryPath: debugBin, scriptPath: path.join(repo, "daemon.sh") };
      }

      const daemonSh = path.join(repo, "daemon.sh");
      if (fs.existsSync(daemonSh)) {
        return { repoPath: repo, binaryPath: null, scriptPath: daemonSh };
      }

      return { repoPath: repo, binaryPath: null, scriptPath: null };
    }

    return { repoPath: null, binaryPath: null, scriptPath: null };
  }

  public async getStatus(): Promise<{
    available: boolean;
    repoPath: string | null;
    daemonPath: string | null;
    models: ThunderModelInfo[];
    error?: string;
  }> {
    const resolved = this.resolveDaemon();
    if (!resolved.binaryPath && !resolved.scriptPath) {
      return {
        available: false,
        repoPath: resolved.repoPath,
        daemonPath: null,
        models: [],
        error: "Thunder daemon binary or daemon.sh not found."
      };
    }

    try {
      await this.ensureRunning();
      const ping = await this.ping();
      let models: ThunderModelInfo[] = [];
      try {
        models = await this.listModels();
      } catch {
        // Models might be empty if no provider credentials yet
      }
      return {
        available: Boolean(ping?.pong),
        repoPath: resolved.repoPath,
        daemonPath: resolved.binaryPath || resolved.scriptPath,
        models
      };
    } catch (err) {
      return {
        available: false,
        repoPath: resolved.repoPath,
        daemonPath: resolved.binaryPath || resolved.scriptPath,
        models: [],
        error: err instanceof Error ? err.message : String(err)
      };
    }
  }

  public async ensureRunning(): Promise<void> {
    if (this.child && !this.child.killed && this.child.exitCode === null) {
      return;
    }

    if (this.startingPromise) {
      return this.startingPromise;
    }

    this.startingPromise = this.startProcess().finally(() => {
      this.startingPromise = null;
    });

    return this.startingPromise;
  }

  private async startProcess(): Promise<void> {
    const resolved = this.resolveDaemon();
    if (!resolved.binaryPath && !resolved.scriptPath) {
      throw new Error("Thunder daemon binary not found. Please compile thunder-agent-daemon or check repo path.");
    }

    let command: string;
    let args: string[] = [];
    let cwd = resolved.repoPath || process.cwd();

    if (resolved.binaryPath) {
      command = resolved.binaryPath;
      cwd = path.dirname(resolved.binaryPath);
    } else {
      command = "/bin/bash";
      args = [resolved.scriptPath!];
    }

    // Prepare environment with augmented PATH and settings credentials
    const env: Record<string, string> = {
      ...process.env,
      PATH: buildAugmentedPath(process.env.PATH || ""),
      RUST_LOG: process.env.RUST_LOG || "info,thunder_daemon=debug,thunder_agent_root=debug,thunder_agent_loop=debug,thunder_agent_providers=debug"
    } as Record<string, string>;

    try {
      const settings = await loadSettings();
      if (settings?.providers) {
        for (const [providerId, prov] of Object.entries(settings.providers)) {
          const key = (prov as any)?.apiKey;
          if (typeof key === "string" && key.trim()) {
            if (providerId.includes("openai")) env.OPENAI_API_KEY = key.trim();
            else if (providerId.includes("anthropic")) env.ANTHROPIC_API_KEY = key.trim();
            else if (providerId.includes("deepseek")) env.DEEPSEEK_API_KEY = key.trim();
            else if (providerId.includes("google") || providerId.includes("gemini")) env.GEMINI_API_KEY = key.trim();
          }
        }
      }
    } catch {
      // settings loading optional
    }

    console.log(`[thunder-client] Spawning Thunder daemon: command=${command}, args=${JSON.stringify(args)}, cwd=${cwd}`);

    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"]
    });

    this.child = child;

    const rl = readline.createInterface({
      input: child.stdout!,
      terminal: false
    });
    this.rl = rl;

    rl.on("line", (line) => {
      this.handleIncomingLine(line);
    });

    child.stderr?.on("data", (data) => {
      const text = data.toString().trim();
      if (text) {
        console.log("[thunder-daemon:stderr]", text);
      }
    });

    child.on("error", (err) => {
      console.error("[thunder-daemon:error]", err);
      this.cleanup();
    });

    child.on("exit", (code, signal) => {
      console.info(`[thunder-daemon:exit] code=${code} signal=${signal}`);
      this.cleanup();
    });
  }

  private handleIncomingLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;

    let msg: ThunderDaemonIncoming;
    try {
      msg = JSON.parse(trimmed);
    } catch {
      console.warn("[thunder-daemon:malformed]", trimmed);
      return;
    }

    switch (msg.type) {
      case "response": {
        if (msg.id && this.pendingRequests.has(msg.id)) {
          const req = this.pendingRequests.get(msg.id)!;
          this.pendingRequests.delete(msg.id);
          clearTimeout(req.timer);
          if (msg.success) {
            req.resolve(msg.data);
          } else {
            req.reject(new Error(msg.error || "Daemon request failed"));
          }
        }
        break;
      }
      case "observed_event": {
        console.log(`[thunder-client:event] task=${msg.task_id} type=${msg.event?.event?.type}`);
        const task = this.activeTasks.get(msg.task_id);
        if (task?.onEvent) {
          try {
            task.onEvent(msg.event);
          } catch (err) {
            console.error("[thunder-daemon:event-handler-error]", err);
          }
        }
        break;
      }
      case "task_completed": {
        console.log(`[thunder-client:completed] task=${msg.task_id} finish_reason=${msg.finish_reason} content_len=${msg.final_content?.length ?? 0}`);
        const task = this.activeTasks.get(msg.task_id);
        if (task) {
          this.activeTasks.delete(msg.task_id);
          if (msg.finish_reason === "Error" && !msg.final_content) {
            task.reject(new Error("Task terminated with error status (check daemon logs)"));
          } else {
            task.resolve({
              finalContent: msg.final_content,
              finishReason: msg.finish_reason,
              activePlugins: msg.active_plugins
            });
          }
        }
        break;
      }
      case "task_failed": {
        console.error(`[thunder-client:failed] task=${msg.task_id} error=${msg.error}`);
        const task = this.activeTasks.get(msg.task_id);
        if (task) {
          this.activeTasks.delete(msg.task_id);
          task.reject(new Error(msg.error || "Thunder task failed"));
        }
        break;
      }
    }
  }

  private async sendCommand<T = any>(
    method: string,
    params: Record<string, unknown> = {},
    timeoutMs = 15_000
  ): Promise<T> {
    await this.ensureRunning();
    if (!this.child?.stdin || this.child.killed) {
      throw new Error("Thunder daemon is not running");
    }

    const id = `req_${randomUUID()}`;
    const payload = JSON.stringify({ method, id, ...params }) + "\n";

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`Thunder daemon command '${method}' timed out after ${timeoutMs}ms`));
        }
      }, timeoutMs);

      this.pendingRequests.set(id, { resolve, reject, timer });
      this.child!.stdin!.write(payload);
    });
  }

  public async ping(): Promise<{ pong: boolean; version?: string }> {
    return this.sendCommand("ping", {}, 5000);
  }

  public async listModels(): Promise<ThunderModelInfo[]> {
    const res = await this.sendCommand<{ models: ThunderModelInfo[] }>("list_models", {}, 10_000);
    return res?.models || [];
  }

  public async listConversations(): Promise<ThunderConversationSummary[]> {
    try {
      const res = await this.sendCommand<ThunderConversationSummary[] | { conversations?: ThunderConversationSummary[] }>(
        "list_conversations",
        {},
        10_000
      );
      if (Array.isArray(res)) return res;
      if (res && Array.isArray((res as any).conversations)) return (res as any).conversations;
      return this.listConversationsFromDisk();
    } catch {
      return this.listConversationsFromDisk();
    }
  }

  public async getConversation(sessionId: string): Promise<ThunderConversation | null> {
    try {
      const res = await this.sendCommand<ThunderConversation | null>(
        "get_conversation",
        { session_id: sessionId },
        10_000
      );
      if (res && (res as any).id) return res;
      return this.getConversationFromDisk(sessionId);
    } catch {
      return this.getConversationFromDisk(sessionId);
    }
  }

  /**
   * AI-generate a conversation title via the daemon's utility model.
   * Never throws: returns structured error info so the UI can display it.
   */
  public async generateConversationTitle(
    sessionId: string,
    force = false
  ): Promise<ThunderTitleResult> {
    try {
      // Title generation can take 30s+ on slower utility models — long timeout
      const res = await this.sendCommand<{ title?: string }>(
        "generate_title",
        { session_id: sessionId, force },
        60_000
      );
      return { ok: true, title: res?.title };
    } catch (err) {
      return titleErrorResult(err);
    }
  }

  /** Manually set a conversation title (locks it against future auto-renames). */
  public async setConversationTitle(
    sessionId: string,
    title: string
  ): Promise<ThunderTitleResult> {
    try {
      const res = await this.sendCommand<{ title?: string }>(
        "set_conversation_title",
        { session_id: sessionId, title },
        10_000
      );
      return { ok: true, title: res?.title };
    } catch (err) {
      return titleErrorResult(err);
    }
  }

  public async deleteConversation(sessionId: string): Promise<boolean> {
    try {
      const home = os.homedir();
      const convDir = path.join(home, ".thunder", "conversations", sessionId);
      if (fs.existsSync(convDir)) {
        await fs.promises.rm(convDir, { recursive: true, force: true });
        const indexFile = path.join(home, ".thunder", "conversations", "index.json");
        if (fs.existsSync(indexFile)) {
          try {
            const raw = await fs.promises.readFile(indexFile, "utf-8");
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
              const updated = parsed.filter((item: any) => item.id !== sessionId);
              await fs.promises.writeFile(indexFile, JSON.stringify(updated, null, 2));
            } else if (parsed && typeof parsed === "object") {
              delete parsed[sessionId];
              await fs.promises.writeFile(indexFile, JSON.stringify(parsed, null, 2));
            }
          } catch {
            // ignore index parse error
          }
        }
        return true;
      }
      return false;
    } catch (err) {
      console.error("[thunder-client] deleteConversation error:", err);
      return false;
    }
  }

  public async truncateConversation(sessionId: string, keepCount: number): Promise<boolean> {
    try {
      const home = os.homedir();
      const convFile = path.join(home, ".thunder", "conversations", sessionId, "conversation.json");
      if (!fs.existsSync(convFile)) return false;
      const raw = await fs.promises.readFile(convFile, "utf-8");
      const conv = JSON.parse(raw);
      if (conv && Array.isArray(conv.messages)) {
        conv.messages = conv.messages.slice(0, Math.max(0, keepCount));
        conv.updated_at_ms = Date.now();
        await fs.promises.writeFile(convFile, JSON.stringify(conv, null, 2));

        const indexFile = path.join(home, ".thunder", "conversations", "index.json");
        if (fs.existsSync(indexFile)) {
          try {
            const indexRaw = await fs.promises.readFile(indexFile, "utf-8");
            const indexParsed = JSON.parse(indexRaw);
            if (Array.isArray(indexParsed)) {
              const item = indexParsed.find((c: any) => c.id === sessionId);
              if (item) {
                item.message_count = conv.messages.length;
                item.updated_at_ms = conv.updated_at_ms;
                await fs.promises.writeFile(indexFile, JSON.stringify(indexParsed, null, 2));
              }
            } else if (indexParsed && typeof indexParsed === "object" && indexParsed[sessionId]) {
              indexParsed[sessionId].message_count = conv.messages.length;
              indexParsed[sessionId].updated_at_ms = conv.updated_at_ms;
              await fs.promises.writeFile(indexFile, JSON.stringify(indexParsed, null, 2));
            }
          } catch {
            // ignore index update error
          }
        }
        return true;
      }
      return false;
    } catch (err) {
      console.error("[thunder-client] truncateConversation error:", err);
      return false;
    }
  }

  public async getTrace(args: { sessionId: string; taskId?: string }): Promise<ThunderTaskTrace | null> {
    try {
      const resp = await this.sendCommand<ThunderTaskTrace>("get_trace", {
        session_id: args.sessionId,
        task_id: args.taskId
      });
      if (resp) {
        return resp;
      }
    } catch {
      // Fallback to disk read
    }

    try {
      const home = os.homedir();
      const traceDir = path.join(home, ".thunder", "conversations", args.sessionId, "traces");
      if (!fs.existsSync(traceDir)) return null;

      let traceFile: string;
      if (args.taskId) {
        traceFile = path.join(traceDir, `${args.taskId}.json`);
      } else {
        const files = await fs.promises.readdir(traceDir);
        const jsonFiles = files.filter((f) => f.endsWith(".json"));
        if (jsonFiles.length === 0) return null;
        jsonFiles.sort().reverse();
        traceFile = path.join(traceDir, jsonFiles[0]);
      }

      if (fs.existsSync(traceFile)) {
        const raw = await fs.promises.readFile(traceFile, "utf-8");
        return JSON.parse(raw) as ThunderTaskTrace;
      }
      return null;
    } catch {
      return null;
    }
  }

  public async listTraces(args: { sessionId: string }): Promise<Array<{ task_id: string; started_at_ms: number; duration_ms?: number; prompt?: string }>> {
    try {
      const resp = await this.sendCommand<{ traces?: Array<{ task_id: string; started_at_ms: number; duration_ms?: number; prompt?: string }> }>("list_traces", {
        session_id: args.sessionId
      });
      if (resp?.traces && Array.isArray(resp.traces)) {
        return resp.traces;
      }
    } catch {
      // Fallback
    }

    try {
      const home = os.homedir();
      const traceDir = path.join(home, ".thunder", "conversations", args.sessionId, "traces");
      if (!fs.existsSync(traceDir)) return [];
      const files = await fs.promises.readdir(traceDir);
      const results: Array<{ task_id: string; started_at_ms: number; duration_ms?: number; prompt?: string }> = [];
      for (const file of files) {
        if (!file.endsWith(".json")) continue;
        try {
          const raw = await fs.promises.readFile(path.join(traceDir, file), "utf-8");
          const parsed = JSON.parse(raw);
          results.push({
            task_id: parsed.task_id || file.replace(".json", ""),
            started_at_ms: parsed.started_at_ms || 0,
            duration_ms: parsed.duration_ms,
            prompt: parsed.prompt
          });
        } catch {
          // ignore
        }
      }
      return results.sort((a, b) => b.started_at_ms - a.started_at_ms);
    } catch {
      return [];
    }
  }

  private async listConversationsFromDisk(): Promise<ThunderConversationSummary[]> {
    try {
      const home = os.homedir();
      const indexFile = path.join(home, ".thunder", "conversations", "index.json");
      if (fs.existsSync(indexFile)) {
        try {
          const raw = await fs.promises.readFile(indexFile, "utf-8");
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) return parsed;
          if (parsed && typeof parsed === "object") return Object.values(parsed);
        } catch {
          // fallback to directory scan
        }
      }
      const dir = path.join(home, ".thunder", "conversations");
      if (!fs.existsSync(dir)) return [];
      const entries = await fs.promises.readdir(dir, { withFileTypes: true });
      const summaries: ThunderConversationSummary[] = [];
      for (const ent of entries) {
        if (!ent.isDirectory()) continue;
        const convFile = path.join(dir, ent.name, "conversation.json");
        if (fs.existsSync(convFile)) {
          try {
            const convRaw = await fs.promises.readFile(convFile, "utf-8");
            const c = JSON.parse(convRaw);
            summaries.push({
              id: c.id || ent.name,
              title: c.title,
              model: c.model,
              workspace: c.workspace,
              thinking_level: c.thinking_level,
              status: c.status || "active",
              message_count: Array.isArray(c.messages) ? c.messages.length : 0,
              turn_count: c.stats?.turn_count || 0,
              total_tokens: c.stats?.total_tokens || 0,
              created_at_ms: c.created_at_ms || Date.now(),
              updated_at_ms: c.updated_at_ms || Date.now()
            });
          } catch {
            // ignore corrupt entry
          }
        }
      }
      return summaries.sort((a, b) => b.updated_at_ms - a.updated_at_ms);
    } catch {
      return [];
    }
  }

  private async getConversationFromDisk(sessionId: string): Promise<ThunderConversation | null> {
    try {
      const home = os.homedir();
      const convFile = path.join(home, ".thunder", "conversations", sessionId, "conversation.json");
      if (!fs.existsSync(convFile)) return null;
      const raw = await fs.promises.readFile(convFile, "utf-8");
      return JSON.parse(raw) as ThunderConversation;
    } catch {
      return null;
    }
  }

  public async runTask(options: {
    taskId: string;
    prompt: string;
    workspaceDir?: string;
    taskNoteId?: string;
    gtdContext?: {
      title: string;
      status: string;
      backgroundMd: string;
      projects: string[];
      noteAbsPath?: string;
    };
    model?: string;
    sessionId?: string;
    thinking_level?: string;
    useMock?: boolean;
    onEvent?: (event: ThunderObservedEvent) => void;
  }): Promise<{ finalContent?: string; finishReason: string; activePlugins?: string[] }> {
    await this.ensureRunning();
    if (!this.child?.stdin || this.child.killed) {
      throw new Error("Thunder daemon is not running");
    }

    const taskId = options.taskId;

    return new Promise<{ finalContent?: string; finishReason: string; activePlugins?: string[] }>(
      async (resolve, reject) => {
        this.activeTasks.set(taskId, {
          onEvent: options.onEvent,
          resolve,
          reject
        });

        try {
          let effectivePrompt = options.prompt;
          if (options.gtdContext) {
            const ctx = options.gtdContext;
            const lines = [
              `# Active GTD Task: ${ctx.title || "Untitled Task"} (Status: ${ctx.status || "inbox"})`,
              options.workspaceDir ? `Workspace Directory: ${options.workspaceDir}` : undefined,
              ctx.projects && ctx.projects.length > 0
                ? `Shared Repositories / 共享目录:\n${ctx.projects.map((p) => `- ${p}`).join("\n")}`
                : undefined,
              ctx.backgroundMd?.trim()
                ? `## GTD Task Background Knowledge / 背景知识:\n${ctx.backgroundMd.trim()}`
                : undefined
            ].filter(Boolean);

            effectivePrompt = `[GTD Task Context]\n${lines.join("\n\n")}\n[End Task Context]\n\n${options.prompt}`;
          } else if (options.workspaceDir && options.workspaceDir.trim()) {
            const ws = options.workspaceDir.trim();
            effectivePrompt = `[Active Workspace: ${ws}]\n\n${options.prompt}`;
          }

          // Send run_task request (acknowledged synchronously)
          await this.sendCommand(
            "run_task",
            {
              task_id: taskId,
              prompt: effectivePrompt,
              workspace_dir: options.workspaceDir,
              model: options.model,
              thinking_level: options.thinking_level,
              session_id: options.sessionId,
              use_mock: options.useMock
            },
            30_000
          );
        } catch (err) {
          this.activeTasks.delete(taskId);
          reject(err);
        }
      }
    );
  }

  public async cancelTask(taskId: string): Promise<boolean> {
    if (!this.child || this.child.killed) return false;
    try {
      const res = await this.sendCommand<{ task_id: string; cancelled: boolean }>(
        "cancel_task",
        { task_id: taskId },
        5000
      );
      return Boolean(res?.cancelled);
    } catch {
      return false;
    }
  }

  public async reloadProviders(): Promise<void> {
    try {
      if (this.child && !this.child.killed && this.child.exitCode === null) {
        this.cleanup();
        await this.ensureRunning();
      }
    } catch (err) {
      console.error("[thunder-client] Failed to reload providers:", err);
    }
  }

  public cleanup(): void {
    for (const [id, req] of this.pendingRequests) {
      clearTimeout(req.timer);
      req.reject(new Error("Thunder daemon process closed"));
    }
    this.pendingRequests.clear();

    for (const [taskId, task] of this.activeTasks) {
      task.reject(new Error("Thunder daemon process closed"));
    }
    this.activeTasks.clear();

    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }

    if (this.child && !this.child.killed) {
      try {
        this.child.kill("SIGTERM");
      } catch {
        // ignore
      }
      this.child = null;
    }
  }
}

let singletonClient: ThunderClient | null = null;

export function getThunderClient(): ThunderClient {
  if (!singletonClient) {
    singletonClient = new ThunderClient();
  }
  return singletonClient;
}
