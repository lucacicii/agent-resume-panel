import * as crypto from "node:crypto";
import * as vscode from "vscode";
import { expandHome } from "../history/pathUtils";
import { getChatApiConfig } from "./config";
import { handoffChatToAgent } from "./handoff";
import { scheduleChatAgentLink } from "./linkAgent";
import { fetchChatModels, streamChatCompletion } from "./openaiClient";
import {
  appendChatMessage,
  getChatRecord,
  loadChatMessages,
  updateChatRecord
} from "./store";
import { ChatMessage, ChatSessionRecord } from "./types";
import { buildProjectContext, expandWorkspaceReferences, urisToFileReferences } from "./workspaceContext";

export class ChatPanelManager {
  private readonly panels = new Map<string, ChatPanel>();

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly reloadTree: () => Promise<void>,
    private readonly onHandoff: (chatId: string) => void
  ) {}

  open(record: ChatSessionRecord): void {
    const existing = this.panels.get(record.id);
    if (existing) {
      existing.reveal();
      return;
    }

    const panel = new ChatPanel(this.context, record, this.reloadTree, this.onHandoff, () => {
      this.panels.delete(record.id);
    });
    this.panels.set(record.id, panel);
  }

  hasPanel(chatId: string): boolean {
    return this.panels.has(chatId);
  }

  async runHandoff(chatId: string): Promise<boolean> {
    const panel = this.panels.get(chatId);
    if (panel) {
      return panel.runHandoff();
    }
    return false;
  }

  appendSummary(chatId: string, message: ChatMessage): void {
    const panel = this.panels.get(chatId);
    if (panel) {
      panel.appendSummary(message);
    }
  }

  dispose(): void {
    for (const panel of this.panels.values()) {
      panel.dispose();
    }
    this.panels.clear();
  }
}

class ChatPanel {
  private readonly panel: vscode.WebviewPanel;
  private readonly panelHome: string;
  private record: ChatSessionRecord;
  private messages: ChatMessage[] = [];
  private models: string[] = [];
  private abortController?: AbortController;
  private isRunning = false;
  private isHandingOff = false;

  constructor(
    private readonly context: vscode.ExtensionContext,
    record: ChatSessionRecord,
    private readonly reloadTree: () => Promise<void>,
    private readonly onHandoff: (chatId: string) => void,
    private readonly onDispose: () => void
  ) {
    this.record = record;
    this.panelHome = expandHome(vscode.workspace.getConfiguration("agentResume").get<string>("panelHome", "~/.agent-resume-panel"));

    this.panel = vscode.window.createWebviewPanel(
      "agentResume.chatPanel",
      this.title(),
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "media")]
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
    this.onDispose();
  }

  async runHandoff(): Promise<boolean> {
    if (this.isHandingOff) {
      vscode.window.showWarningMessage("Handoff already in progress.");
      this.postHandoffState();
      return false;
    }
    if (this.isRunning) {
      vscode.window.showWarningMessage("Wait for the assistant reply to finish, then click Handoff to Agent.");
      this.postHandoffState();
      return false;
    }

    this.isHandingOff = true;
    this.postHandoffState();
    try {
      this.record = await handoffChatToAgent(this.context, this.panelHome, this.record);
      scheduleChatAgentLink(this.record.id, this.reloadTree);
      this.onHandoff(this.record.id);
      await this.reloadTree();
      vscode.window.showInformationMessage(
        `Handoff sent to ${this.record.linkedAgent.provider}. The linked agent terminal is running in the background.`
      );
      return true;
    } catch (error) {
      this.post({ type: "error", message: `Handoff failed: ${formatError(error)}` });
      vscode.window.showErrorMessage(`Handoff failed: ${formatError(error)}`);
      return false;
    } finally {
      this.isHandingOff = false;
      this.postInit();
      this.postHandoffState();
    }
  }

  private postHandoffState(): void {
    this.post({
      type: "status",
      status: this.isRunning ? "thinking" : "ready",
      isRunning: this.isRunning,
      isHandingOff: this.isHandingOff
    });
  }

  appendSummary(message: ChatMessage): void {
    this.messages.push(message);
    this.post({ type: "message", message });
    this.postInit();
  }

  private async bootstrap(): Promise<void> {
    this.messages = await loadChatMessages(this.panelHome, this.record.id);
    await this.loadModels();
    this.postInit();
    this.post({ type: "history", messages: this.messages });
  }

  private async handleMessage(message: { type: string; text?: string; model?: string; uris?: string[] }): Promise<void> {
    switch (message.type) {
      case "ready":
        await this.loadModels();
        this.postInit();
        this.post({ type: "history", messages: this.messages });
        return;
      case "setModel":
        if (!this.isRunning) {
          this.record.model = message.model || undefined;
          await updateChatRecord(this.panelHome, this.record);
        }
        return;
      case "send":
        await this.sendMessage(message.text ?? "");
        return;
      case "handoff":
        await this.runHandoff();
        return;
      case "stop":
        this.abortController?.abort();
        this.isRunning = false;
        this.post({ type: "status", status: "ready", isRunning: false });
        return;
      case "dropFiles": {
        const refs = urisToFileReferences(message.uris ?? [], this.record.projectPath);
        if (!refs.length) {
          vscode.window.showWarningMessage("Dropped files must belong to the chat project.");
          return;
        }
        this.post({
          type: "insertText",
          text: refs.join(" ")
        });
        return;
      }
    }
  }

  private async sendMessage(rawText: string): Promise<void> {
    const text = rawText.trim();
    if (!text || this.isRunning) {
      return;
    }

    const { baseUrl, apiKey } = await getChatApiConfig(this.context);
    if (!apiKey) {
      vscode.window.showErrorMessage(
        "Set agentResume.chatApiKey in Settings, or run Agent Resume: Set Chat API Key."
      );
      return;
    }

    const expanded = await expandWorkspaceReferences(text, this.record.projectPath);
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      text: expanded,
      timestamp: Date.now()
    };

    this.messages.push(userMessage);
    await appendChatMessage(this.panelHome, this.record.id, userMessage);
    this.post({ type: "message", message: userMessage });

    if (this.record.title === "New Chat") {
      this.record.title = truncate(text, 48);
    }
    this.record.messageCount += 1;
    this.record.updatedAt = Date.now();
    await updateChatRecord(this.panelHome, this.record);

    const config = vscode.workspace.getConfiguration("agentResume");
    const fallbackModel = config.get<string>("chatDefaultModel", "gpt-4o-mini");
    const model = this.record.model || this.models[0] || fallbackModel;
    const systemPrompt = await this.buildSystemPrompt(
      config.get<string>("chatSystemPrompt", "You are a helpful coding assistant. Be concise and practical."),
      config.get<boolean>("chatIncludeProjectContext", true)
    );

    this.isRunning = true;
    this.abortController = new AbortController();
    this.post({ type: "status", status: "thinking", isRunning: true });

    const assistantId = crypto.randomUUID();
    let assistantText = "";

    try {
      assistantText = await streamChatCompletion({
        baseUrl,
        apiKey,
        model,
        systemPrompt,
        messages: this.messages.filter((entry) => entry.role !== "system"),
        signal: this.abortController.signal,
        onDelta: (delta) => {
          this.post({
            type: "assistantDelta",
            id: assistantId,
            text: delta
          });
        }
      });

      const assistantMessage: ChatMessage = {
        id: assistantId,
        role: "assistant",
        text: assistantText,
        timestamp: Date.now()
      };
      this.messages.push(assistantMessage);
      await appendChatMessage(this.panelHome, this.record.id, assistantMessage);
      this.post({ type: "assistantDone", message: assistantMessage });
      this.record.updatedAt = Date.now();
      await updateChatRecord(this.panelHome, this.record);
      await this.reloadTree();

      if (config.get<boolean>("chatAutoHandoff", false)) {
        await this.runHandoff();
      }
    } catch (error) {
      if (this.abortController.signal.aborted) {
        this.post({ type: "status", status: "stopped", isRunning: false });
        return;
      }
      this.post({ type: "error", message: formatError(error) });
    } finally {
      this.isRunning = false;
      this.abortController = undefined;
      this.post({ type: "status", status: "ready", isRunning: false });
    }
  }

  private async buildSystemPrompt(basePrompt: string, includeProjectContext: boolean): Promise<string> {
    if (!includeProjectContext) {
      return basePrompt;
    }

    try {
      const projectContext = await buildProjectContext(this.record.projectPath);
      return `${basePrompt}\n\n${projectContext}`;
    } catch (error) {
      this.post({ type: "error", message: `Project context unavailable: ${formatError(error)}` });
      return basePrompt;
    }
  }

  private async loadModels(): Promise<void> {
    const { baseUrl, apiKey } = await getChatApiConfig(this.context);
    if (!apiKey) {
      this.models = fallbackModels();
      return;
    }

    try {
      this.models = await fetchChatModels(baseUrl, apiKey);
      if (this.record.model && !this.models.includes(this.record.model)) {
        this.models.unshift(this.record.model);
      }
    } catch (error) {
      this.models = fallbackModels();
      this.post({ type: "error", message: `Failed to load models: ${formatError(error)}` });
    }
  }

  private postInit(): void {
    const config = vscode.workspace.getConfiguration("agentResume");
    const fallbackModel = config.get<string>("chatDefaultModel", "gpt-4o-mini");
    this.post({
      type: "init",
      init: {
        title: this.record.title,
        projectPath: this.record.projectPath,
        provider: this.record.linkedAgent.provider,
        sessionId: this.record.linkedAgent.sessionId,
        handoffCount: this.record.linkedAgent.handoffCount,
        models: this.models,
        model: this.record.model || this.models[0] || fallbackModel,
        isRunning: this.isRunning,
        isHandingOff: this.isHandingOff
      }
    });
    this.panel.title = this.title();
  }

  private title(): string {
    const provider = this.record.linkedAgent.provider;
    const link = this.record.linkedAgent.sessionId ? "linked" : "pending";
    return `Chat → ${provider} (${link}): ${truncate(this.record.title, 28)}`;
  }

  private post(payload: unknown): void {
    void this.panel.webview.postMessage(payload);
  }

  private renderHtml(): string {
    const nonce = crypto.randomBytes(16).toString("base64");
    const scriptUri = this.panel.webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "media", "chatPanel.js"));
    const styleUri = this.panel.webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "media", "chatPanel.css"));
    const csp = [
      "default-src 'none'",
      `style-src ${this.panel.webview.cspSource} 'unsafe-inline'`,
      `script-src 'nonce-${nonce}'`
    ].join("; ");

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${styleUri}">
  <title>Chat Panel</title>
</head>
<body>
  <header id="header"></header>
  <main id="messages"></main>
  <footer id="composer">
    <textarea id="input" rows="4" placeholder="Ask about this project. Type @path/to/file or drag files from Explorer."></textarea>
    <div class="actions">
      <select id="model"></select>
      <button id="handoff" type="button">Handoff to Agent</button>
      <button id="stop" type="button" disabled>Stop</button>
      <button id="send" type="button">Send</button>
    </div>
  </footer>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

export async function handoffChatSession(
  context: vscode.ExtensionContext,
  panelHome: string,
  chatId: string,
  reloadTree: () => Promise<void>,
  onHandoff: (chatId: string) => void
): Promise<void> {
  const record = await getChatRecord(panelHome, chatId);
  if (!record) {
    vscode.window.showWarningMessage("Chat session not found.");
    return;
  }

  const updated = await handoffChatToAgent(context, panelHome, record);
  scheduleChatAgentLink(updated.id, reloadTree);
  onHandoff(updated.id);
  await reloadTree();
  vscode.window.showInformationMessage("Handoff sent to linked agent.");
}

function fallbackModels(): string[] {
  const config = vscode.workspace.getConfiguration("agentResume");
  const configured = config.get<string[]>("chatModels", []);
  if (configured.length) {
    return configured;
  }
  const fallback = config.get<string>("chatDefaultModel", "gpt-4o-mini");
  return fallback ? [fallback] : [];
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}