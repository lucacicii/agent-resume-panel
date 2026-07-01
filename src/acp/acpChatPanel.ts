import * as crypto from "node:crypto";
import * as vscode from "vscode";
import { expandHome } from "../history/pathUtils";
import { AcpAgentConnection } from "./agentConnection";
import { subscribeSessionUpdates, clearSessionUpdateListeners } from "./sessionUpdateBus";
import {
  appendAcpMessage,
  loadAcpMessages,
  updateAcpRecord
} from "./store";
import {
  AcpChatMessage,
  AcpSessionRecord,
  AcpToolCallInfo,
  AcpToolCallLocation,
  AcpToolCallStatus
} from "./types";

interface AcpMode {
  id: string;
  name: string;
}

interface ModesState {
  currentModeId: string;
  availableModes: AcpMode[];
}

export class AcpChatPanel {
  private readonly panel: vscode.WebviewPanel;
  private readonly panelHome: string;
  private record: AcpSessionRecord;
  private messages: AcpChatMessage[] = [];
  private connection?: AcpAgentConnection;
  private abortController?: AbortController;
  private isRunning = false;
  private isConnecting = false;
  private availableModes: AcpMode[] = [];
  private currentModeId?: string;
  private unsubscribeSessionUpdates?: () => void;
  private streamingAssistantId?: string;
  private turnAssistantId?: string;
  private streamingText = "";
  private activeAcpSessionId?: string;
  private isRestoringHistory = false;
  private historyReplayDone?: () => void;

  constructor(
    private readonly context: vscode.ExtensionContext,
    record: AcpSessionRecord,
    private readonly reloadTree: () => Promise<void>,
    private readonly onDispose: () => void
  ) {
    this.record = record;
    this.panelHome = expandHome(
      vscode.workspace.getConfiguration("agentResume").get<string>("panelHome", "~/.agent-resume-panel")
    );

    this.panel = vscode.window.createWebviewPanel(
      "agentResume.acpChatPanel",
      this.title(),
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(context.extensionUri, "media"),
          vscode.Uri.joinPath(context.extensionUri, "node_modules", "marked"),
          vscode.Uri.joinPath(context.extensionUri, "node_modules", "dompurify")
        ]
      }
    );

    this.panel.webview.html = this.renderHtml();
    this.panel.webview.onDidReceiveMessage((message) => void this.handleMessage(message));
    this.panel.onDidDispose(() => this.dispose());
    void this.bootstrap();
  }

  reveal(): void {
    this.panel.reveal(vscode.ViewColumn.Beside);
  }

  dispose(): void {
    this.abortController?.abort();
    if (this.activeAcpSessionId) {
      clearSessionUpdateListeners(this.activeAcpSessionId);
    }
    this.unsubscribeSessionUpdates?.();
    this.connection?.dispose();
    this.connection = undefined;
    this.onDispose();
  }

  private async bootstrap(): Promise<void> {
    this.messages = migrateLegacyToolMessages(await loadAcpMessages(this.panelHome, this.record.id));
    this.post({ type: "history", messages: this.messages });
    await this.ensureAgentSession();
    this.postInit();
  }

  private async ensureAgentSession(): Promise<void> {
    if (this.isConnecting) {
      return;
    }

    this.isConnecting = true;
    this.post({ type: "status", status: "connecting", isRunning: false, isConnecting: true });

    try {
      this.connection?.dispose();
      this.connection = new AcpAgentConnection(this.record.provider);

      if (this.record.acpSessionId) {
        this.activeAcpSessionId = this.record.acpSessionId;
        this.setupSessionUpdates();
        this.isRestoringHistory = true;
        try {
          const result = await this.connection.restoreSession(this.record.acpSessionId, this.record.projectPath);
          if (result.sessionId !== this.record.acpSessionId) {
            this.record.acpSessionId = result.sessionId;
            this.activeAcpSessionId = result.sessionId;
            this.record.updatedAt = Date.now();
            await updateAcpRecord(this.panelHome, this.record);
          }
          this.applyModes(result.modes);
          if (result.method === "load") {
            await this.waitForHistoryReplay();
          }
        } finally {
          this.isRestoringHistory = false;
          this.historyReplayDone = undefined;
        }
      } else {
        const result = await this.connection.startSession(this.record.projectPath);
        this.record.acpSessionId = result.sessionId;
        this.activeAcpSessionId = result.sessionId;
        this.applyModes(result.modes);
        this.record.updatedAt = Date.now();
        await updateAcpRecord(this.panelHome, this.record);
        this.setupSessionUpdates();
      }

      this.post({ type: "status", status: "ready", isRunning: false, isConnecting: false });
    } catch (error) {
      this.post({
        type: "error",
        message: `Failed to connect to ${this.record.provider} agent: ${formatError(error)}`
      });
      this.post({ type: "status", status: "error", isRunning: false, isConnecting: false });
    } finally {
      this.isConnecting = false;
    }
  }

  private waitForHistoryReplay(): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, 3000);
      this.historyReplayDone = () => {
        clearTimeout(timer);
        resolve();
      };
    });
  }

  private applyModes(modes: ModesState | null | undefined): void {
    if (!modes) {
      return;
    }
    this.availableModes = modes.availableModes ?? [];
    this.currentModeId = modes.currentModeId ?? this.availableModes[0]?.id;
    if (this.currentModeId) {
      this.record.currentModeId = this.currentModeId;
    }
  }

  private setupSessionUpdates(): void {
    if (!this.activeAcpSessionId) {
      return;
    }

    this.unsubscribeSessionUpdates?.();
    this.unsubscribeSessionUpdates = subscribeSessionUpdates(this.activeAcpSessionId, (payload) => {
      this.handleSessionUpdate(payload.update);
    });
  }

  private handleSessionUpdate(update: Record<string, unknown>): void {
    const kind = update.sessionUpdate;
    if (typeof kind !== "string") {
      return;
    }

    if (this.isRestoringHistory) {
      if (kind === "available_commands_update") {
        this.historyReplayDone?.();
      }
      if (
        kind === "user_message_chunk" ||
        kind === "agent_message_chunk" ||
        kind === "agent_thought_chunk" ||
        kind === "tool_call" ||
        kind === "tool_call_update"
      ) {
        return;
      }
    }

    switch (kind) {
      case "agent_message_chunk":
        this.handleAgentChunk(update);
        break;
      case "agent_thought_chunk":
        break;
      case "tool_call":
        this.upsertTurnToolCall(parseToolCallFromUpdate(update, "pending"));
        break;
      case "tool_call_update":
        this.upsertTurnToolCall(parseToolCallFromUpdate(update));
        break;
      case "plan":
        this.handlePlan(update);
        break;
      case "current_mode_update":
        if (typeof update.currentModeId === "string") {
          this.currentModeId = update.currentModeId;
          this.record.currentModeId = update.currentModeId;
          void updateAcpRecord(this.panelHome, this.record);
          this.postInit();
        }
        break;
    }
  }

  private handleAgentChunk(update: Record<string, unknown>): void {
    const delta = extractTextFromContent(update.content);
    if (!delta) {
      return;
    }

    const chunkMessageId = typeof update.messageId === "string" ? update.messageId : undefined;
    const messageId = chunkMessageId ?? this.turnAssistantId ?? this.streamingAssistantId ?? crypto.randomUUID();

    if (this.streamingAssistantId && messageId !== this.streamingAssistantId) {
      this.finalizeStreamingAssistant();
    }

    if (!this.streamingAssistantId) {
      this.streamingAssistantId = messageId;
      this.streamingText = delta;
    } else {
      this.streamingText += delta;
    }

    this.postAssistantUpdate(this.getAssistantMessage(this.streamingAssistantId));
  }

  private getAssistantMessage(id: string): AcpChatMessage {
    const existing = this.messages.find((entry) => entry.id === id);
    if (existing) {
      return existing;
    }
    return {
      id,
      role: "assistant",
      text: id === this.streamingAssistantId ? this.streamingText : "",
      timestamp: Date.now(),
      toolCalls: []
    };
  }

  private ensureTurnAssistantMessage(): AcpChatMessage {
    const turnId = this.turnAssistantId;
    if (!turnId) {
      throw new Error("No active assistant turn.");
    }

    if (!this.streamingAssistantId) {
      this.streamingAssistantId = turnId;
    }

    const index = this.messages.findIndex((entry) => entry.id === turnId);
    if (index >= 0) {
      return this.messages[index];
    }

    const stub: AcpChatMessage = {
      id: turnId,
      role: "assistant",
      text: "",
      timestamp: Date.now(),
      toolCalls: []
    };
    this.messages.push(stub);
    return stub;
  }

  private upsertTurnToolCall(incoming: AcpToolCallInfo): void {
    if (!this.turnAssistantId) {
      return;
    }

    const assistant = this.ensureTurnAssistantMessage();
    const toolCalls = [...(assistant.toolCalls ?? [])];
    const index = toolCalls.findIndex((entry) => entry.toolCallId === incoming.toolCallId);
    if (index >= 0) {
      toolCalls[index] = mergeToolCallInfo(toolCalls[index], incoming);
    } else {
      toolCalls.push(incoming);
    }

    assistant.toolCalls = toolCalls;
    if (this.streamingText && this.streamingAssistantId === assistant.id) {
      assistant.text = this.streamingText;
    }

    const messageIndex = this.messages.findIndex((entry) => entry.id === assistant.id);
    if (messageIndex >= 0) {
      this.messages[messageIndex] = assistant;
    }

    this.postAssistantUpdate(assistant);
  }

  private postAssistantUpdate(assistant: AcpChatMessage): void {
    const streaming = this.isRunning && this.streamingAssistantId === assistant.id;
    if (streaming) {
      this.post({
        type: "assistantDelta",
        id: assistant.id,
        text: assistant.text,
        toolCalls: assistant.toolCalls ?? [],
        streaming: true
      });
      return;
    }

    this.post({ type: "messageUpdate", message: assistant });
  }

  private handlePlan(update: Record<string, unknown>): void {
    const text = formatPlanText(update);
    if (!text) {
      return;
    }

    const message: AcpChatMessage = {
      id: crypto.randomUUID(),
      role: "plan",
      text,
      timestamp: Date.now()
    };
    this.upsertMessage(message);
  }

  private upsertMessage(message: AcpChatMessage): void {
    const index = this.messages.findIndex((entry) => entry.id === message.id);
    if (index >= 0) {
      this.messages[index] = message;
      this.post({ type: "messageUpdate", message });
    } else {
      this.messages.push(message);
      this.post({ type: "message", message });
    }
    void appendAcpMessage(this.panelHome, this.record.id, message);
  }

  private async handleMessage(message: { type: string; text?: string; modeId?: string; href?: string }): Promise<void> {
    switch (message.type) {
      case "ready":
        this.postInit();
        this.post({ type: "history", messages: this.messages });
        return;
      case "send":
        await this.sendMessage(message.text ?? "");
        return;
      case "stop":
        if (this.activeAcpSessionId && this.connection) {
          await this.connection.cancel(this.activeAcpSessionId);
        }
        this.abortController?.abort();
        this.isRunning = false;
        this.finalizeStreamingAssistant();
        this.post({ type: "status", status: "ready", isRunning: false, isConnecting: false });
        return;
      case "setMode":
        await this.setMode(message.modeId ?? "");
        return;
      case "reconnect":
        await this.ensureAgentSession();
        this.postInit();
        return;
      case "openLink":
        if (message.href) {
          await vscode.env.openExternal(vscode.Uri.parse(message.href));
        }
        return;
    }
  }

  private async setMode(modeId: string): Promise<void> {
    if (!modeId || !this.connection || !this.activeAcpSessionId || this.isRunning) {
      return;
    }

    try {
      await this.connection.setMode(this.activeAcpSessionId, modeId);
      this.currentModeId = modeId;
      this.record.currentModeId = modeId;
      this.record.updatedAt = Date.now();
      await updateAcpRecord(this.panelHome, this.record);
      this.postInit();
    } catch (error) {
      this.post({ type: "error", message: `Mode switch failed: ${formatError(error)}` });
    }
  }

  private async sendMessage(rawText: string): Promise<void> {
    const text = rawText.trim();
    if (!text || this.isRunning || this.isConnecting || !this.connection || !this.activeAcpSessionId) {
      return;
    }

    const userMessage: AcpChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      text,
      timestamp: Date.now()
    };

    this.messages.push(userMessage);
    await appendAcpMessage(this.panelHome, this.record.id, userMessage);
    this.post({ type: "message", message: userMessage });

    if (this.record.title === "New ACP Chat") {
      this.record.title = truncate(text, 48);
    }
    this.record.messageCount += 1;
    this.record.updatedAt = Date.now();
    await updateAcpRecord(this.panelHome, this.record);
    this.postInit();

    this.isRunning = true;
    this.abortController = new AbortController();
    this.turnAssistantId = crypto.randomUUID();
    this.streamingAssistantId = undefined;
    this.streamingText = "";
    this.post({ type: "status", status: "thinking", isRunning: true, isConnecting: false });

    try {
      await this.connection.prompt(this.activeAcpSessionId, text);
      this.finalizeStreamingAssistant();
      this.record.updatedAt = Date.now();
      await updateAcpRecord(this.panelHome, this.record);
      await this.reloadTree();
    } catch (error) {
      if (this.abortController.signal.aborted) {
        this.finalizeStreamingAssistant();
        this.post({ type: "status", status: "stopped", isRunning: false, isConnecting: false });
        return;
      }
      this.post({ type: "error", message: formatError(error) });
    } finally {
      this.isRunning = false;
      this.abortController = undefined;
      this.post({ type: "status", status: "ready", isRunning: false, isConnecting: false });
    }
  }

  private finalizeStreamingAssistant(): void {
    const turnId = this.streamingAssistantId ?? this.turnAssistantId;
    if (!turnId) {
      this.streamingText = "";
      return;
    }

    const index = this.messages.findIndex((entry) => entry.id === turnId);
    const existing = index >= 0 ? this.messages[index] : undefined;
    const text = this.streamingText.trim() || existing?.text?.trim() || "";
    const toolCalls = existing?.toolCalls;

    if (!text && !toolCalls?.length) {
      if (index >= 0) {
        this.messages.splice(index, 1);
      }
      this.streamingAssistantId = undefined;
      this.turnAssistantId = undefined;
      this.streamingText = "";
      return;
    }

    const assistantMessage: AcpChatMessage = {
      id: turnId,
      role: "assistant",
      text,
      timestamp: existing?.timestamp ?? Date.now(),
      toolCalls: toolCalls?.length ? toolCalls : undefined
    };

    if (index >= 0) {
      this.messages[index] = assistantMessage;
    } else {
      this.messages.push(assistantMessage);
    }

    void appendAcpMessage(this.panelHome, this.record.id, assistantMessage);
    this.post({ type: "assistantDone", message: assistantMessage, streaming: false });
    this.streamingAssistantId = undefined;
    this.turnAssistantId = undefined;
    this.streamingText = "";
  }

  private postInit(): void {
    this.post({
      type: "init",
      init: {
        title: this.record.title,
        projectPath: this.record.projectPath,
        provider: this.record.provider,
        acpSessionId: this.record.acpSessionId,
        modes: this.availableModes,
        modeId: this.currentModeId,
        isRunning: this.isRunning,
        isConnecting: this.isConnecting,
        status: this.isConnecting ? "connecting" : this.isRunning ? "running" : "ready"
      }
    });
    this.panel.title = this.title();
  }

  private title(): string {
    const mode = this.currentModeId ? ` · ${this.currentModeId}` : "";
    return `ACP ${this.record.provider}${mode}: ${truncate(this.record.title, 28)}`;
  }

  private post(payload: unknown): void {
    void this.panel.webview.postMessage(payload);
  }

  private renderHtml(): string {
    const nonce = crypto.randomBytes(16).toString("base64");
    const markedUri = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "node_modules", "marked", "lib", "marked.umd.js")
    );
    const purifyUri = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "node_modules", "dompurify", "dist", "purify.min.js")
    );
    const scriptUri = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "media", "acpChat.js")
    );
    const styleUri = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "media", "acpChat.css")
    );
    const csp = [
      "default-src 'none'",
      `style-src ${this.panel.webview.cspSource} 'unsafe-inline'`,
      `script-src 'nonce-${nonce}' ${this.panel.webview.cspSource}`,
      `img-src ${this.panel.webview.cspSource} https: data:`
    ].join("; ");

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${styleUri}">
  <title>ACP Chat</title>
</head>
<body class="chat-shell">
  <header id="header">
    <div class="header-main">
      <span id="status-dot" class="status-dot connecting" aria-hidden="true"></span>
      <div class="header-text">
        <div id="header-title">ACP Chat</div>
        <div id="header-meta"></div>
      </div>
    </div>
    <div class="header-actions">
      <select id="mode" hidden aria-label="Agent mode"></select>
      <button id="reconnect" type="button" title="Reconnect">↻</button>
      <button id="stop" type="button" disabled title="Stop">■</button>
    </div>
  </header>
  <main id="messages" class="chat-messages"></main>
  <footer id="composer">
    <div class="composer-bar">
      <textarea id="input" rows="1" placeholder="Message the agent…" aria-label="Message"></textarea>
      <button id="send" type="button" aria-label="Send">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.01 21 23 12 2.01 3 2 10l15 2-15 2z"/></svg>
      </button>
    </div>
  </footer>
  <script nonce="${nonce}" src="${markedUri}"></script>
  <script nonce="${nonce}" src="${purifyUri}"></script>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function extractTextFromContent(content: unknown): string {
  if (!content || typeof content !== "object") {
    return "";
  }
  const block = content as { type?: string; text?: string };
  if (block.type === "text" && typeof block.text === "string") {
    return block.text;
  }
  return "";
}

function migrateLegacyToolMessages(messages: AcpChatMessage[]): AcpChatMessage[] {
  const result: AcpChatMessage[] = [];

  for (const message of messages) {
    if (message.role !== "tool") {
      result.push({
        ...message,
        toolCalls: message.toolCalls?.length ? [...message.toolCalls] : undefined
      });
      continue;
    }

    const info = legacyToolMessageToInfo(message);
    let attached = false;

    for (let index = result.length - 1; index >= 0; index -= 1) {
      if (result[index].role !== "assistant") {
        continue;
      }

      const assistant = result[index];
      const toolCalls = [...(assistant.toolCalls ?? [])];
      const existingIndex = toolCalls.findIndex((entry) => entry.toolCallId === info.toolCallId);
      if (existingIndex >= 0) {
        toolCalls[existingIndex] = mergeToolCallInfo(toolCalls[existingIndex], info);
      } else {
        toolCalls.push(info);
      }
      result[index] = { ...assistant, toolCalls };
      attached = true;
      break;
    }

    if (!attached) {
      result.push({
        id: crypto.randomUUID(),
        role: "assistant",
        text: "",
        timestamp: message.timestamp,
        toolCalls: [info]
      });
    }
  }

  return result;
}

function legacyToolMessageToInfo(message: AcpChatMessage): AcpToolCallInfo {
  const lines = message.text.split("\n");
  const firstLine = lines[0] ?? "Tool";
  const match = firstLine.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
  const title = match ? match[1].trim() : firstLine;
  const statusFromText = match?.[2];
  const contentText = lines.slice(1).join("\n").trim();
  const content = contentText ? [{ type: "text", text: contentText }] : undefined;

  return {
    toolCallId: message.toolCallId ?? message.id,
    title,
    kind: "other",
    status: normalizeToolStatus(message.status ?? statusFromText ?? "completed"),
    content
  };
}

function normalizeToolStatus(value: unknown): AcpToolCallStatus {
  if (value === "pending" || value === "in_progress" || value === "completed" || value === "failed") {
    return value;
  }
  return "in_progress";
}

function parseLocations(value: unknown): AcpToolCallLocation[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const locations: AcpToolCallLocation[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const location = item as { path?: string; line?: number };
    if (typeof location.path !== "string") {
      continue;
    }
    const entry: AcpToolCallLocation = { path: location.path };
    if (typeof location.line === "number") {
      entry.line = location.line;
    }
    locations.push(entry);
  }

  return locations.length ? locations : undefined;
}

function parseToolCallFromUpdate(
  update: Record<string, unknown>,
  defaultStatus?: AcpToolCallStatus
): AcpToolCallInfo {
  const toolCallId = typeof update.toolCallId === "string" ? update.toolCallId : crypto.randomUUID();
  const title = typeof update.title === "string" ? update.title : "Tool";
  const kind = typeof update.kind === "string" ? update.kind : "other";
  const status = normalizeToolStatus(
    typeof update.status === "string" ? update.status : defaultStatus ?? "in_progress"
  );

  return {
    toolCallId,
    title,
    kind,
    status,
    locations: parseLocations(update.locations),
    content: Array.isArray(update.content) ? update.content : undefined,
    rawInput: update.rawInput,
    rawOutput: update.rawOutput
  };
}

function mergeToolCallInfo(existing: AcpToolCallInfo, incoming: AcpToolCallInfo): AcpToolCallInfo {
  return {
    toolCallId: incoming.toolCallId || existing.toolCallId,
    title: incoming.title || existing.title,
    kind: incoming.kind || existing.kind,
    status: incoming.status || existing.status,
    locations: incoming.locations ?? existing.locations,
    content: incoming.content ?? existing.content,
    rawInput: incoming.rawInput !== undefined ? incoming.rawInput : existing.rawInput,
    rawOutput: incoming.rawOutput !== undefined ? incoming.rawOutput : existing.rawOutput
  };
}

function formatPlanText(update: Record<string, unknown>): string {
  const entries = update.entries;
  if (!Array.isArray(entries) || !entries.length) {
    return typeof update.title === "string" ? update.title : "";
  }

  return entries
    .map((entry, index) => {
      if (!entry || typeof entry !== "object") {
        return "";
      }
      const step = entry as { content?: string; status?: string };
      const content = typeof step.content === "string" ? step.content : "Step";
      const status = typeof step.status === "string" ? ` [${step.status}]` : "";
      return `${index + 1}. ${content}${status}`;
    })
    .filter(Boolean)
    .join("\n");
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}