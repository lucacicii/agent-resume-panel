import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as readline from "node:readline";
import { randomUUID } from "node:crypto";
import { loadSettings } from "@agent-resume/core";
import { buildAugmentedPath } from "../processPath";
import {
  describeThunderResolution,
  resolveThunderDaemon,
  resolveThunderTui,
  type ThunderDaemonLocation,
  type ThunderDaemonSettings
} from "./daemonResolver";
import type {
  ThunderDaemonIncoming,
  ThunderModelInfo,
  ThunderObservedEvent,
  ThunderConversationSummary,
  ThunderConversation,
  ThunderImageAttachment,
  ThunderQueueBehavior,
  ThunderTaskTrace,
  ThunderTitleResult,
  ThunderModeChanged,
  ThunderPermissionMode,
  ThunderUiRequest,
  ThunderUiAnswer
} from "./thunderProtocol";

/** How long a loaded `settings.thunder` snapshot is trusted before re-reading it. */
const THUNDER_SETTINGS_TTL_MS = 5_000;

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
  private thunderSettings: ThunderDaemonSettings | null = null;
  private thunderSettingsLoadedAt = 0;

  /**
   * Listeners for frames that belong to a *session* rather than a task.
   *
   * Every other daemon frame is routed by `task_id` into the run's own event
   * stream, which means it can only reach a surface while a run is live. A mode
   * change and a permission dialog are exactly the frames that arrive when
   * nothing is running, so they need their own way out.
   */
  private modeListeners = new Set<(payload: ThunderModeChanged) => void>();
  private uiRequestListeners = new Set<(request: ThunderUiRequest) => void>();

  /** Observe approval-mode changes for every session (filter by `sessionId` yourself). */
  public onModeChanged(listener: (payload: ThunderModeChanged) => void): () => void {
    this.modeListeners.add(listener);
    return () => this.modeListeners.delete(listener);
  }

  /** Observe dialogs waiting for an answer (`ui_request`). */
  public onUiRequest(listener: (request: ThunderUiRequest) => void): () => void {
    this.uiRequestListeners.add(listener);
    return () => this.uiRequestListeners.delete(listener);
  }

  /**
   * Re-read `settings.thunder` so a hand-edited settings.json takes effect without a
   * restart. Cached briefly because `getStatus()` races with UI polling.
   */
  public async refreshThunderSettings(force = false): Promise<void> {
    const now = Date.now();
    if (!force && this.thunderSettingsLoadedAt && now - this.thunderSettingsLoadedAt < THUNDER_SETTINGS_TTL_MS) {
      return;
    }
    this.thunderSettingsLoadedAt = now;
    try {
      const settings = await loadSettings();
      this.thunderSettings = settings?.thunder ?? null;
    } catch {
      // Settings are optional; discovery keeps working from env vars and layout probes.
      this.thunderSettings = null;
    }
  }

  /**
   * Locate the Thunder daemon. The rules live in `./daemonResolver` (pure, unit-tested);
   * this only supplies the runtime context.
   */
  public resolveDaemon(): ThunderDaemonLocation {
    const location = resolveThunderDaemon({
      moduleDir: __dirname,
      cwd: process.cwd(),
      resourcesPath: process.resourcesPath,
      settings: this.thunderSettings
    });
    if (process.env.THUNDER_DEBUG === "1") {
      console.log(`[thunder-client] resolveDaemon → ${describeThunderResolution(location)}`);
    }
    return location;
  }

  /**
   * Locate the Thunder TUI binary with the same discovery rules as the daemon, so
   * the `cli:thunder` new-session target works wherever the daemon resolves.
   */
  public resolveTui(): ThunderDaemonLocation {
    const location = resolveThunderTui({
      moduleDir: __dirname,
      cwd: process.cwd(),
      resourcesPath: process.resourcesPath,
      settings: this.thunderSettings
    });
    if (process.env.THUNDER_DEBUG === "1") {
      console.log(`[thunder-client] resolveTui → ${describeThunderResolution(location)}`);
    }
    return location;
  }

  public async getStatus(): Promise<{
    available: boolean;
    repoPath: string | null;
    daemonPath: string | null;
    /** Resolved `thunder-tui` binary (or its build script), for the TUI new-session target. */
    tuiPath: string | null;
    models: ThunderModelInfo[];
    /** Which discovery rule matched; `none` means nothing usable was found. */
    source: ThunderDaemonLocation["source"];
    /** Probed paths, for the settings UI / doctor output. */
    candidates: string[];
    error?: string;
  }> {
    await this.refreshThunderSettings();
    const resolved = this.resolveDaemon();
    const resolvedTui = this.resolveTui();
    const tuiPath = resolvedTui.binaryPath || resolvedTui.scriptPath;
    if (!resolved.binaryPath && !resolved.scriptPath) {
      return {
        available: false,
        repoPath: resolved.repoPath,
        daemonPath: null,
        tuiPath,
        models: [],
        source: resolved.source,
        candidates: resolved.candidates,
        error: resolved.repoPath
          ? `Found a thunder checkout at ${resolved.repoPath}, but it has no daemon binary. Build it: cargo build --release -p thunder-agent-daemon`
          : "Thunder daemon not found. Set THUNDER_PATH (a thunder checkout), THUNDER_DAEMON_BIN (a binary), or settings.thunder.{repoPath,daemonPath}."
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
        tuiPath,
        models,
        source: resolved.source,
        candidates: resolved.candidates
      };
    } catch (err) {
      return {
        available: false,
        repoPath: resolved.repoPath,
        daemonPath: resolved.binaryPath || resolved.scriptPath,
        tuiPath,
        models: [],
        source: resolved.source,
        candidates: resolved.candidates,
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
    await this.refreshThunderSettings();
    const resolved = this.resolveDaemon();
    if (!resolved.binaryPath && !resolved.scriptPath) {
      throw new Error(
        `Thunder daemon not found (${describeThunderResolution(resolved)}). ` +
          "Set THUNDER_PATH to a thunder checkout, or build thunder-agent-daemon."
      );
    }

    let command: string;
    let args: string[] = [];
    let cwd = resolved.repoPath || process.cwd();

    if (resolved.binaryPath) {
      command = resolved.binaryPath;
      // Never run with a cwd inside the app bundle: `Resources` is read-only for
      // notarized builds and the daemon's cwd is only a fallback workspace anyway
      // (the panel passes `workspace_dir` per task).
      cwd = resolved.source === "bundled" ? os.homedir() : path.dirname(resolved.binaryPath);
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
        } else {
          console.warn(`[thunder-client:completed] No active task listener found for task=${msg.task_id}`);
        }
        break;
      }
      case "task_failed": {
        console.error(`[thunder-client:failed] task=${msg.task_id} error=${msg.error}`);
        const task = this.activeTasks.get(msg.task_id);
        if (task) {
          this.activeTasks.delete(msg.task_id);
          task.reject(new Error(msg.error || "Thunder task failed"));
        } else {
          console.warn(`[thunder-client:failed] No active task listener found for task=${msg.task_id}`);
        }
        break;
      }
      case "user_question": {
        // The agent is blocked awaiting an answer. Re-shape it into the standard
        // observed-event envelope so the renderer's existing switch handles it
        // without a second event channel.
        console.log(`[thunder-client:user_question] task=${msg.task_id} q=${msg.question_id}`);
        const task = this.activeTasks.get(msg.task_id);
        if (task?.onEvent) {
          try {
            task.onEvent({
              agent_id: msg.task_id,
              event: {
                type: "user_question",
                question_id: msg.question_id,
                questions: msg.questions
              }
            } as ThunderObservedEvent);
          } catch (err) {
            console.error("[thunder-daemon:user-question-handler-error]", err);
          }
        }
        break;
      }
      case "task_paused": {
        console.log(`[thunder-client:task_paused] task=${msg.task_id} reason=${msg.reason}`);
        const task = this.activeTasks.get(msg.task_id);
        if (task?.onEvent) {
          try {
            task.onEvent({
              agent_id: msg.task_id,
              event: { type: "task_paused", reason: msg.reason }
            } as ThunderObservedEvent);
          } catch (err) {
            console.error("[thunder-daemon:task-paused-handler-error]", err);
          }
        }
        break;
      }
      case "task_queue_update": {
        const task = this.activeTasks.get(msg.task_id);
        if (task?.onEvent) {
          try {
            task.onEvent({
              agent_id: msg.task_id,
              event: {
                type: "task_queue_update",
                steering: msg.steering ?? [],
                follow_up: msg.follow_up ?? []
              }
            } as ThunderObservedEvent);
          } catch (err) {
            console.error("[thunder-daemon:task-queue-handler-error]", err);
          }
        }
        break;
      }
      case "mode_changed": {
        // Pushed, not answered: it never rides a task's stream, so it goes to
        // the session-scoped listeners. This is the only way a surface learns
        // the mode moved when nothing is running — including when the *model*
        // got a plan approved mid-run.
        const payload: ThunderModeChanged = {
          sessionId: msg.session_id,
          taskId: msg.task_id,
          mode: msg.mode as ThunderPermissionMode,
          previous: msg.previous as ThunderPermissionMode | undefined,
          source: msg.source === "plan_approved"
            ? "planApproved"
            : msg.source === "run_option"
              ? "runOption"
              : "user"
        };
        console.log(
          `[thunder-client:mode] session=${payload.sessionId} ${payload.previous ?? "?"} -> ${payload.mode} (${payload.source})`
        );
        for (const listener of this.modeListeners) {
          try {
            listener(payload);
          } catch (err) {
            console.error("[thunder-daemon:mode-listener-error]", err);
          }
        }
        break;
      }
      case "ui_request": {
        // A blocking dialog. `ui` discriminates the shape and its siblings were
        // flattened in beside it (see ThunderDaemonIncoming).
        const request: ThunderUiRequest = {
          requestId: msg.request_id,
          taskId: msg.task_id,
          sessionId: msg.session_id,
          source: msg.source === "host" ? "host" : "plugin",
          ui: msg.ui as ThunderUiRequest["ui"],
          title: msg.title,
          options: msg.options,
          message: msg.message,
          placeholder: msg.placeholder,
          prefill: msg.prefill,
          path: msg.path,
          content: msg.content,
          timeoutMs: msg.timeout_ms
        };
        console.log(
          `[thunder-client:ui] request=${request.requestId} ui=${request.ui} source=${request.source}`
        );
        for (const listener of this.uiRequestListeners) {
          try {
            listener(request);
          } catch (err) {
            console.error("[thunder-daemon:ui-listener-error]", err);
          }
        }
        break;
      }
      case "ui_notice": {
        console.log(`[thunder-daemon:notice] ${msg.level}: ${msg.message}`);
        break;
      }
      case "ui_status": {
        console.log(`[thunder-daemon:status] ${msg.key}=${msg.text ?? ""}`);
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
      if (Array.isArray(res)) return this.spokenOnly(res);
      if (res && Array.isArray((res as any).conversations)) {
        return this.spokenOnly((res as any).conversations);
      }
      return this.listConversationsFromDisk();
    } catch {
      return this.listConversationsFromDisk();
    }
  }

  /**
   * A conversation nobody has spoken to is not a session. The store refuses to
   * persist one and the daemon already filters `list_conversations`; this keeps
   * rows an older build wrote out of the panel's list as well.
   */
  private spokenOnly(rows: ThunderConversationSummary[]): ThunderConversationSummary[] {
    return rows.filter((row) => (row.turn_count ?? 0) > 0);
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
          if (Array.isArray(parsed)) return this.spokenOnly(parsed);
          if (parsed && typeof parsed === "object") {
            return this.spokenOnly(Object.values(parsed) as ThunderConversationSummary[]);
          }
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
              total_used_tokens: c.stats?.total_used_tokens ?? c.stats?.total_tokens ?? 0,
              created_at_ms: c.created_at_ms || Date.now(),
              updated_at_ms: c.updated_at_ms || Date.now()
            });
          } catch {
            // ignore corrupt entry
          }
        }
      }
      return this.spokenOnly(summaries).sort((a, b) => b.updated_at_ms - a.updated_at_ms);
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
    /** Extra roots (referenced repositories) granted the workspace's read/write standing. */
    extraWorkspaceDirs?: string[];
    taskNoteId?: string;
    gtdContext?: {
      title: string;
      status: string;
      backgroundMd: string;
      projects: string[];
      noteAbsPath?: string;
      /**
       * How this task wants its work checked out, from the same address table the
       * managed block is written from. Absent means the task has no worktree
       * convention, and the plain bilingual rule below stands in for it.
       */
      worktreeLines?: string[];
    };
    model?: string;
    sessionId?: string;
    thinking_level?: string;
    attachments?: ThunderImageAttachment[];
    /**
     * Non-interactive run: the daemon omits the `ask_user_question` tool
     * entirely. Nothing can answer a question on a scheduled run, and a parked
     * question costs the full 1800s request timeout, so an unattended caller
     * must pass `true` rather than rely on the daemon default (which is `false`
     * for backward compatibility with interactive hosts).
     */
    headless?: boolean;
    /**
     * Permission mode for this run (`plan` / `ask` / `acceptEdits` / `yolo`).
     *
     * Stated explicitly rather than inherited, because the inherited value comes
     * from `~/.thunder/config.json`'s `agent.defaultMode` — a global setting that
     * would otherwise silently change how every schedule behaves. An unattended
     * run wants `yolo`; a read-only sweep wants `plan`.
     */
    mode?: string;
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
                ? `Shared Repositories / 共享目录:\n${ctx.projects.map((p) => `- ${p}`).join("\n")}\n${
                  ctx.worktreeLines?.length
                    ? ctx.worktreeLines.join("\n")
                    : "When a change touches any referenced repository (one or more): create a new worktree on a new branch per affected repo — never commit straight to the shared branches. Repos that require PRs go through PR review and merge the PR(s) when the task is done; repos that allow direct push (e.g. a private GitLab, a personal GitHub repo) push the branch and merge it when the task is done, no PR required. / 当改动涉及任一引用仓库（一个或多个）时：每个受影响仓库新建 worktree + 新分支 —— 不要直接提交到共享分支。要求 PR 的仓库走 PR 评审，任务完成时合并 PR；允许直推的仓库（如私有 GitLab、个人 GitHub 仓库）推分支、任务完成时合并即可，不强制开 PR。"
                }`
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
              extra_workspace_dirs:
                options.extraWorkspaceDirs && options.extraWorkspaceDirs.length > 0
                  ? options.extraWorkspaceDirs
                  : undefined,
              model: options.model,
              thinking_level: options.thinking_level,
              session_id: options.sessionId,
              headless: options.headless === true ? true : undefined,
              mode: options.mode,
              attachments:
                options.attachments && options.attachments.length > 0
                  ? options.attachments
                  : undefined
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

  /** Answer a pending `ask_user_question` so the parked agent can continue. */
  public async answerQuestion(options: {
    questionId: string;
    answers?: Record<string, string>;
    cancelled?: boolean;
  }): Promise<boolean> {
    const res = await this.sendCommand<{ delivered?: boolean }>(
      "answer_question",
      {
        question_id: options.questionId,
        answers: options.answers ?? {},
        cancelled: options.cancelled ?? false
      },
      10_000
    );
    return Boolean(res?.delivered);
  }

  /** Cooperatively pause a running task at its next tool boundary. */
  public async pauseTask(taskId: string): Promise<boolean> {
    const res = await this.sendCommand<{ paused?: boolean }>("pause_task", { task_id: taskId }, 10_000);
    return Boolean(res?.paused);
  }

  /** Resume a paused task. */
  public async resumeTask(taskId: string): Promise<boolean> {
    const res = await this.sendCommand<{ resumed?: boolean }>("resume_task", { task_id: taskId }, 10_000);
    return Boolean(res?.resumed);
  }

  /**
   * Queue user input into a running task.
   *
   * `behavior` is required by the daemon: `steer` enters at the next turn
   * boundary (after the current tool calls), `follow_up` only once the run has
   * nothing else to do. Neither interrupts a tool that is executing.
   */
  public async steerTask(
    taskId: string,
    message: string,
    behavior: ThunderQueueBehavior,
    attachments?: ThunderImageAttachment[]
  ): Promise<{ queued: number } | null> {
    const res = await this.sendCommand<{ queued?: number }>(
      "steer_task",
      { task_id: taskId, message, behavior, attachments },
      10_000
    );
    if (res === null) return null;
    return { queued: res?.queued ?? 0 };
  }

  /**
   * Drop everything queued into a running task and return its text, so the
   * caller can put it back in the editor when the user aborts.
   */
  public async clearTaskQueue(
    taskId: string
  ): Promise<{ steering: string[]; followUp: string[] } | null> {
    const res = await this.sendCommand<{ steering?: string[]; follow_up?: string[] }>(
      "clear_queue",
      { task_id: taskId },
      10_000
    );
    if (res === null) return null;
    return { steering: res?.steering ?? [], followUp: res?.follow_up ?? [] };
  }

  /**
   * Read the mode a session is judged by, plus the rules it has remembered.
   *
   * This is the hydration source for a surface that has just opened a session:
   * the daemon keeps the mode in memory per `session_id`, and it is deliberately
   * not part of the stored conversation.
   *
   * One wrinkle worth knowing: a session that has *never* run is created here in
   * Thunder's default (`yolo`), while that session's first run resolves
   * `.thunder`'s `agent.defaultMode` instead. A `mode_changed` with
   * `source: "runOption"` arrives at that first run and corrects whatever is on
   * screen.
   */
  public async getPermissionState(
    sessionId: string
  ): Promise<{ mode: ThunderPermissionMode; rules: unknown[] } | null> {
    const res = await this.sendCommand<{ mode?: string; rules?: unknown[] }>(
      "get_permission_state",
      { session_id: sessionId },
      10_000
    );
    if (res === null || !res?.mode) return null;
    return { mode: res.mode as ThunderPermissionMode, rules: res.rules ?? [] };
  }

  /**
   * Set the mode a session is judged by.
   *
   * Takes effect on the session's next run *and* on a run already in flight, at
   * its next tool call. Only the four canonical values are sent: Thunder's
   * parser also accepts pre-0.4 aliases (`bypass_permissions`, `never`, ...),
   * but those are a compatibility layer for old config files, not a value space
   * a UI should be able to reach.
   *
   * Rejects when the daemon refuses (an unknown mode, or a daemon predating
   * `set_mode`) — that rejection is what lets a caller roll its optimistic
   * update back instead of showing a mode the daemon never accepted.
   */
  public async setMode(
    sessionId: string,
    mode: ThunderPermissionMode
  ): Promise<{ mode: ThunderPermissionMode } | null> {
    const res = await this.sendCommand<{ mode?: string }>(
      "set_mode",
      { session_id: sessionId, mode },
      10_000
    );
    if (res === null) return null;
    return { mode: (res?.mode as ThunderPermissionMode) ?? mode };
  }

  /**
   * Answer a `ui_request`. The daemon resolves the blocked caller and reports
   * whether the answer reached it (`delivered: false` for a stale request id —
   * a late answer can never land on a later dialog).
   */
  public async answerUi(
    answer: ThunderUiAnswer
  ): Promise<{ requestId: string; delivered: boolean }> {
    const res = await this.sendCommand<{ request_id?: string; delivered?: boolean }>(
      "answer_ui",
      {
        request_id: answer.requestId,
        value: answer.value,
        confirmed: answer.confirmed,
        cancelled: answer.cancelled === true
      },
      10_000
    );
    return {
      requestId: res?.request_id ?? answer.requestId,
      delivered: Boolean(res?.delivered)
    };
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
      await this.refreshThunderSettings(true);
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
