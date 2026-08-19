import * as crypto from "node:crypto";
import * as path from "node:path";
import * as vscode from "vscode";
import { expandHome } from "../history/pathUtils";
import { AcpAgentConnection, AcpPromptBlock } from "./agentConnection";
import { subscribeSessionUpdates, clearSessionUpdateListeners } from "./sessionUpdateBus";
import {
  appendAcpMessage,
  getAcpRecord,
  IncomingAcpImage,
  loadAcpMessages,
  readAcpImageBase64,
  saveAcpImageAttachments,
  updateAcpRecord,
  validateIncomingImages
} from "./store";
import { getAcpChatUiStrings } from "../webview/uiStrings";
import {
  AcpChatMessage,
  AcpImageAttachment,
  AcpSessionRecord,
  AcpToolCallInfo,
  AcpToolCallLocation,
  AcpToolCallStatus
} from "./types";

type WebviewImageAttachment = AcpImageAttachment & { previewUrl: string };

type WebviewChatMessage = Omit<AcpChatMessage, "images"> & {
  images?: WebviewImageAttachment[];
};

interface WebviewSendPayload {
  type: string;
  text?: string;
  images?: IncomingAcpImage[];
  modeId?: string;
  href?: string;
}

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
  private isReplayingLoadedHistory = false;
  private historyReplayDone?: () => void;
  private readonly initialPrompt?: string;
  private initialPromptSent = false;
  private pendingExternalStoreRefresh = false;

  constructor(
    private readonly context: vscode.ExtensionContext,
    record: AcpSessionRecord,
    private readonly reloadTree: () => Promise<void>,
    private readonly onDispose: () => void,
    options?: { initialPrompt?: string }
  ) {
    this.initialPrompt = options?.initialPrompt?.trim() || undefined;
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
          vscode.Uri.joinPath(context.extensionUri, "node_modules", "dompurify"),
          vscode.Uri.file(path.join(this.panelHome, "acp", "attachments"))
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

  refreshLocalizedUi(): void {
    this.postInit();
  }

  async refreshExternalStore(): Promise<void> {
    if (this.isRunning || this.isConnecting) {
      this.pendingExternalStoreRefresh = true;
      return;
    }
    await this.reloadExternalStore();
  }

  dispose(): void {
    this.abortController?.abort();
    if (this.activeAcpSessionId) {
      clearSessionUpdateListeners(this.activeAcpSessionId);
    }
    this.unsubscribeSessionUpdates?.();
    this.unsubscribeSessionUpdates = undefined;
    this.connection?.dispose();
    this.connection = undefined;
    this.onDispose();
  }

  private async bootstrap(): Promise<void> {
    await this.reloadExternalStore();
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
      if (this.activeAcpSessionId) {
        clearSessionUpdateListeners(this.activeAcpSessionId);
      }
      this.unsubscribeSessionUpdates?.();
      this.unsubscribeSessionUpdates = undefined;
      this.connection?.dispose();
      this.connection = new AcpAgentConnection(this.record.provider, this.record.projectPath);

      if (this.record.acpSessionId) {
        const previousSessionId = this.record.acpSessionId;
        this.activeAcpSessionId = previousSessionId;
        this.isReplayingLoadedHistory = false;
        try {
          const result = await this.connection.restoreSession(previousSessionId, this.record.projectPath);
          if (result.sessionId !== previousSessionId) {
            clearSessionUpdateListeners(previousSessionId);
            this.record.acpSessionId = result.sessionId;
            this.activeAcpSessionId = result.sessionId;
            this.record.updatedAt = Date.now();
            await updateAcpRecord(this.panelHome, this.record);
          }
          this.applyModes(result.modes);
          if (result.method === "load") {
            this.isReplayingLoadedHistory = true;
            await this.waitForHistoryReplay();
          }
        } finally {
          this.isReplayingLoadedHistory = false;
          this.historyReplayDone = undefined;
        }
      } else {
        const result = await this.connection.startSession(this.record.projectPath);
        this.record.acpSessionId = result.sessionId;
        this.activeAcpSessionId = result.sessionId;
        this.applyModes(result.modes);
        this.record.updatedAt = Date.now();
        await updateAcpRecord(this.panelHome, this.record);
      }

      this.setupSessionUpdates();

      this.post({ type: "status", status: "ready", isRunning: false, isConnecting: false });
      await this.sendInitialPromptIfNeeded();
    } catch (error) {
      this.post({
        type: "error",
        message: `Failed to connect to ${this.record.provider} agent: ${formatError(error)}`
      });
      this.post({ type: "status", status: "error", isRunning: false, isConnecting: false });
    } finally {
      this.isConnecting = false;
      await this.flushExternalStoreRefresh();
    }
  }

  private async reloadExternalStore(): Promise<void> {
    const latestRecord = await getAcpRecord(this.panelHome, this.record.id);
    if (latestRecord) {
      this.record = latestRecord;
    }
    this.messages = migrateLegacyToolMessages(await loadAcpMessages(this.panelHome, this.record.id));
    this.postHistory();
    this.postInit();
  }

  private async flushExternalStoreRefresh(): Promise<void> {
    if (!this.pendingExternalStoreRefresh || this.isRunning || this.isConnecting) {
      return;
    }
    this.pendingExternalStoreRefresh = false;
    await this.reloadExternalStore();
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

    if (this.isReplayingLoadedHistory) {
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
      case "agent_thought_chunk":
        this.handleAgentChunk(update);
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
    if (!delta || !this.turnAssistantId) {
      return;
    }

    if (!this.streamingAssistantId) {
      this.streamingAssistantId = this.turnAssistantId;
      this.streamingText = delta;
    } else {
      this.streamingText += delta;
    }

    this.postAssistantUpdate(this.getAssistantMessage(this.turnAssistantId));
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
      this.post({ type: "messageUpdate", message: this.enrichMessageForWebview(message) });
    } else {
      this.messages.push(message);
      this.post({ type: "message", message: this.enrichMessageForWebview(message) });
    }
    void appendAcpMessage(this.panelHome, this.record.id, message);
  }

  private async handleMessage(message: WebviewSendPayload): Promise<void> {
    switch (message.type) {
      case "ready":
        this.postInit();
        this.postHistory();
        return;
      case "send":
        await this.sendMessage(message.text ?? "", message.images ?? []);
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

  private async sendInitialPromptIfNeeded(): Promise<void> {
    if (!this.initialPrompt || this.initialPromptSent || this.isRunning || this.isConnecting) {
      return;
    }

    this.initialPromptSent = true;
    await this.sendMessage(this.initialPrompt);
  }

  private async sendMessage(rawText: string, rawImages: IncomingAcpImage[] = []): Promise<void> {
    const text = rawText.trim();
    const images = rawImages.filter((image) => image.data);

    if ((!text && !images.length) || this.isRunning || this.isConnecting || !this.connection || !this.activeAcpSessionId) {
      return;
    }

    if (images.length) {
      const validationError = validateIncomingImages(images);
      if (validationError) {
        this.post({ type: "error", message: validationError });
        return;
      }
      if (!this.connection.supportsImageUpload()) {
        this.post({ type: "error", message: `${this.record.provider} does not support image uploads.` });
        return;
      }
    }

    const messageId = crypto.randomUUID();
    const savedImages = images.length
      ? await saveAcpImageAttachments(this.panelHome, this.record.id, messageId, images)
      : undefined;

    const userMessage: AcpChatMessage = {
      id: messageId,
      role: "user",
      text,
      timestamp: Date.now(),
      images: savedImages
    };

    this.messages.push(userMessage);
    await appendAcpMessage(this.panelHome, this.record.id, userMessage);
    this.post({ type: "message", message: this.enrichMessageForWebview(userMessage) });

    if (this.record.title === "New ACP Chat") {
      const titleSource = text || savedImages?.[0]?.fileName || "Image message";
      this.record.title = truncate(titleSource, 48);
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

    const turnId = this.turnAssistantId;
    try {
      const blocks = await this.buildPromptBlocks(text, savedImages);
      await this.connection.prompt(this.activeAcpSessionId, blocks);
      await this.drainSessionUpdates();
      this.finalizeStreamingAssistant();
      if (turnId && !this.messages.some((entry) => entry.role === "assistant" && entry.id === turnId)) {
        this.post({
          type: "error",
          message: "Agent returned an empty response. Try again or check Codex permissions."
        });
      }
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
      await this.flushExternalStoreRefresh();
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
    this.post({ type: "assistantDone", message: this.enrichMessageForWebview(assistantMessage), streaming: false });
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
        status: this.isConnecting ? "connecting" : this.isRunning ? "running" : "ready",
        imageUpload: this.connection?.supportsImageUpload() ?? false,
        uiStrings: getAcpChatUiStrings()
      }
    });
    this.panel.title = this.title();
  }

  private postHistory(): void {
    this.post({
      type: "history",
      messages: this.messages.map((entry) => this.enrichMessageForWebview(entry))
    });
  }

  private enrichMessageForWebview(message: AcpChatMessage): WebviewChatMessage {
    const { images, ...rest } = message;
    const enriched: WebviewChatMessage = { ...rest };
    if (!images?.length) {
      return enriched;
    }

    enriched.images = images.map((image) => ({
      ...image,
      previewUrl: this.panel.webview
        .asWebviewUri(vscode.Uri.file(path.join(this.panelHome, image.storagePath)))
        .toString()
    }));
    return enriched;
  }

  private async drainSessionUpdates(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  private async buildPromptBlocks(text: string, images?: AcpImageAttachment[]): Promise<AcpPromptBlock[]> {
    const blocks: AcpPromptBlock[] = [];

    for (const image of images ?? []) {
      blocks.push({
        type: "image",
        mimeType: image.mimeType,
        data: await readAcpImageBase64(this.panelHome, image)
      });
    }

    if (text) {
      blocks.push({ type: "text", text });
    }

    return blocks;
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
    <div id="pending-images" class="pending-images" hidden></div>
    <div class="composer-bar">
      <button id="attach" type="button" class="attach-btn" hidden title="Attach image" aria-label="Attach image">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16.5 6v11.5a4 4 0 0 1-8 0V5a2.5 2.5 0 0 1 5 0v10.5a1 1 0 0 1-2 0V6h-1.5v9.5a2.5 2.5 0 0 0 5 0V5a4 4 0 0 0-8 0v12.5a5.5 5.5 0 0 0 11 0V6z"/></svg>
      </button>
      <input id="file-input" type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden>
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
