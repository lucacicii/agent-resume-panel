import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { expandHome } from "../history/pathUtils";
import { agentUriIconPath, buildWebviewAgentIconMap } from "../icons/agentIcons";
import { AcpAgentConnection, AcpPromptBlock, normalizeConfigOptionsArray } from "./agentConnection";
import { sortConfigOptions } from "./configNormalization";
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
  AcpAgentProvider,
  AcpAvailableCommand,
  AcpChatMessage,
  AcpConfigOption,
  AcpImageAttachment,
  AcpPlanEntry,
  AcpSessionRecord,
  AcpToolCallInfo,
  AcpToolCallLocation,
  AcpToolCallStatus,
  AcpUsageInfo
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
  configId?: string;
  value?: string | boolean;
  valueType?: "select" | "boolean";
  source?: "configOption" | "mode" | "model";
  href?: string;
  path?: string;
  line?: number;
}

interface AcpMode {
  id: string;
  name: string;
}

interface ModesState {
  currentModeId: string;
  availableModes: AcpMode[];
}

const PROVIDER_LABELS: Record<AcpAgentProvider, string> = {
  codex: "Codex",
  claude: "Claude",
  agy: "Antigravity",
  grok: "Grok Build",
  opencode: "OpenCode",
  pi: "Pi",
  prime: "Prime Agent",
  omp: "OMP"
};

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
  private configOptions: AcpConfigOption[] = [];
  private availableCommands: AcpAvailableCommand[] = [];
  private usage?: AcpUsageInfo;
  private unsubscribeSessionUpdates?: () => void;
  private streamingAssistantId?: string;
  private turnAssistantId?: string;
  private turnPlanMessageId?: string;
  private streamingText = "";
  private streamingThinking = "";
  private activeAcpSessionId?: string;
  private isReplayingLoadedHistory = false;
  private historyReplayDone?: () => void;
  private cancelledByUser = false;
  private readonly initialPrompt?: string;
  private initialPromptSent = false;
  private pendingExternalStoreRefresh = false;

  constructor(
    private readonly context: vscode.ExtensionContext,
    record: AcpSessionRecord,
    private readonly reloadTree: () => Promise<void>,
    private readonly onDispose: () => void,
    options?: { initialPrompt?: string; existingPanel?: vscode.WebviewPanel }
  ) {
    this.initialPrompt = options?.initialPrompt?.trim() || undefined;
    this.record = record;
    this.panelHome = expandHome(
      vscode.workspace.getConfiguration("agentResume").get<string>("panelHome", "~/.agent-resume-panel")
    );

    const localResourceRoots = [
      vscode.Uri.joinPath(context.extensionUri, "media"),
      vscode.Uri.joinPath(context.extensionUri, "resources"),
      vscode.Uri.joinPath(context.extensionUri, "node_modules", "marked"),
      vscode.Uri.joinPath(context.extensionUri, "node_modules", "dompurify"),
      vscode.Uri.file(path.join(this.panelHome, "acp", "attachments"))
    ];

    if (options?.existingPanel) {
      this.panel = options.existingPanel;
      this.panel.title = this.title();
      this.panel.webview.options = {
        enableScripts: true,
        localResourceRoots
      };
    } else {
      this.panel = vscode.window.createWebviewPanel(
        "agentResume.acpChatPanel",
        this.title(),
        vscode.ViewColumn.Beside,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots
        }
      );
    }

    this.panel.iconPath =
      agentUriIconPath(this.context.extensionUri, this.record.provider) ??
      vscode.Uri.joinPath(this.context.extensionUri, "resources", "agent-resume.svg");
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

  private resolveWorkingDirectory(): { cwd: string; fallbackFrom?: string } {
    const configured = path.resolve(this.record.projectPath);
    if (isExistingDirectory(configured)) {
      return { cwd: configured };
    }

    const baseName = path.basename(configured);
    const folders = vscode.workspace.workspaceFolders ?? [];
    const matchingFolder = folders.find(
      (folder) => path.basename(folder.uri.fsPath) === baseName && isExistingDirectory(folder.uri.fsPath)
    );
    const firstValidFolder = folders.find((folder) => isExistingDirectory(folder.uri.fsPath));
    const fallback = matchingFolder?.uri.fsPath ?? firstValidFolder?.uri.fsPath ?? os.homedir();

    return {
      cwd: path.resolve(fallback),
      fallbackFrom: this.record.projectPath
    };
  }

  private async ensureAgentSession(): Promise<void> {
    if (this.isConnecting) {
      return;
    }

    this.isConnecting = true;
    this.post({ type: "status", status: "connecting", isRunning: false, isConnecting: true });

    try {
      const { cwd, fallbackFrom } = this.resolveWorkingDirectory();
      if (fallbackFrom && !this.messages.some((entry) => entry.id === "system-cwd-fallback")) {
        const notice: AcpChatMessage = {
          id: "system-cwd-fallback",
          role: "system",
          text: `Project directory not found (${fallbackFrom}). Using ${cwd} instead.`,
          timestamp: Date.now()
        };
        this.messages.push(notice);
        this.post({ type: "message", message: this.enrichMessageForWebview(notice) });
      }

      if (this.activeAcpSessionId) {
        clearSessionUpdateListeners(this.activeAcpSessionId);
      }
      this.unsubscribeSessionUpdates?.();
      this.unsubscribeSessionUpdates = undefined;
      this.connection?.dispose();
      this.connection = new AcpAgentConnection(this.record.provider, cwd);

      if (this.record.acpSessionId) {
        const previousSessionId = this.record.acpSessionId;
        this.activeAcpSessionId = previousSessionId;
        this.isReplayingLoadedHistory = false;
        try {
          const result = await this.connection.restoreSession(previousSessionId, cwd);
          if (result.sessionId !== previousSessionId) {
            clearSessionUpdateListeners(previousSessionId);
            this.record.acpSessionId = result.sessionId;
            this.activeAcpSessionId = result.sessionId;
            this.record.updatedAt = Date.now();
            await updateAcpRecord(this.panelHome, this.record);
          }
          this.applySessionConfig(result.modes, result.configOptions);
          if (result.method === "load") {
            this.isReplayingLoadedHistory = true;
            this.setupSessionUpdates();
            await this.waitForHistoryReplay();
          }
        } finally {
          this.isReplayingLoadedHistory = false;
          this.historyReplayDone = undefined;
        }
      } else {
        const result = await this.connection.startSession(cwd);
        this.record.acpSessionId = result.sessionId;
        this.activeAcpSessionId = result.sessionId;
        this.applySessionConfig(result.modes, result.configOptions);
        this.record.updatedAt = Date.now();
        await updateAcpRecord(this.panelHome, this.record);
      }

      this.setupSessionUpdates();

      this.post({ type: "status", status: "ready", isRunning: false, isConnecting: false });
      await this.sendInitialPromptIfNeeded();
    } catch (error) {
      this.post({
        type: "error",
        message: `Failed to connect to ${PROVIDER_LABELS[this.record.provider] || this.record.provider} agent: ${formatError(error)}`
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

  private applySessionConfig(
    modes: ModesState | null | undefined,
    configOptions: AcpConfigOption[]
  ): void {
    this.applyModes(modes);
    this.configOptions = configOptions;
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
        this.handleAvailableCommandsUpdate(update);
        this.historyReplayDone?.();
        return;
      }
      if (
        kind === "user_message_chunk" ||
        kind === "agent_message_chunk" ||
        kind === "agent_thought_chunk" ||
        kind === "tool_call" ||
        kind === "tool_call_update" ||
        kind === "plan" ||
        kind === "plan_update"
      ) {
        return;
      }
    }

    switch (kind) {
      case "agent_message_chunk":
        this.handleAgentChunk(update, "text");
        break;
      case "agent_thought_chunk":
        this.handleAgentChunk(update, "thinking");
        break;
      case "tool_call":
        this.upsertTurnToolCall(parseToolCallFromUpdate(update, "pending"));
        break;
      case "tool_call_update":
        this.upsertTurnToolCall(parseToolCallFromUpdate(update));
        break;
      case "plan":
      case "plan_update":
        this.handlePlan(update);
        break;
      case "available_commands_update":
        this.handleAvailableCommandsUpdate(update);
        break;
      case "config_option_update":
        this.handleConfigOptionUpdate(update);
        break;
      case "current_mode_update":
        if (typeof update.currentModeId === "string") {
          this.syncCurrentMode(update.currentModeId);
          void updateAcpRecord(this.panelHome, this.record);
          this.postInit();
        }
        break;
      case "session_info_update":
        if (typeof update.title === "string" && update.title.trim()) {
          this.record.title = truncate(update.title.trim(), 72);
          this.record.updatedAt = Date.now();
          void updateAcpRecord(this.panelHome, this.record);
          this.postInit();
          void this.reloadTree();
        }
        break;
      case "usage_update":
        this.handleUsageUpdate(update);
        break;
    }
  }

  private handleAvailableCommandsUpdate(update: Record<string, unknown>): void {
    const raw = update.availableCommands;
    if (!Array.isArray(raw)) {
      return;
    }

    const commands: AcpAvailableCommand[] = [];
    for (const item of raw) {
      if (!item || typeof item !== "object") {
        continue;
      }
      const entry = item as { name?: unknown; description?: unknown; input?: { hint?: unknown } };
      if (typeof entry.name !== "string" || !entry.name.trim()) {
        continue;
      }
      const cmd: AcpAvailableCommand = {
        name: entry.name.trim(),
        description: typeof entry.description === "string" ? entry.description : ""
      };
      if (entry.input && typeof entry.input.hint === "string" && entry.input.hint) {
        cmd.inputHint = entry.input.hint;
      }
      commands.push(cmd);
    }

    this.availableCommands = commands;
    this.post({ type: "commands", commands: this.availableCommands });
  }

  private handleConfigOptionUpdate(update: Record<string, unknown>): void {
    const incoming = normalizeConfigOptionsArray(update.configOptions);
    if (!incoming.length && !Array.isArray(update.configOptions)) {
      return;
    }

    const hasMode = incoming.some((opt) => opt.category === "mode" || opt.id === "mode");
    const hasModel = incoming.some((opt) => opt.category === "model" || opt.id === "model");

    const preservedLegacy = this.configOptions.filter((opt) => {
      if (opt.source === "mode") {
        return !hasMode;
      }
      if (opt.source === "model") {
        return !hasModel;
      }
      return false;
    });

    this.configOptions = sortConfigOptions([...incoming, ...preservedLegacy]);
    const modeOpt = this.configOptions.find(
      (opt): opt is Extract<AcpConfigOption, { type: "select" }> =>
        opt.type === "select" && (opt.category === "mode" || opt.id === "mode")
    );
    if (modeOpt && modeOpt.currentValue) {
      this.currentModeId = modeOpt.currentValue;
      this.record.currentModeId = modeOpt.currentValue;
    }
    this.postInit();
  }

  private handleUsageUpdate(update: Record<string, unknown>): void {
    const used = typeof update.used === "number" ? update.used : undefined;
    const size = typeof update.size === "number" ? update.size : undefined;
    const cost = update.cost as { amount?: unknown; currency?: unknown } | null | undefined;
    const costAmount = typeof cost?.amount === "number" ? cost.amount : undefined;
    const costCurrency = typeof cost?.currency === "string" ? cost.currency : undefined;

    if (used === undefined && size === undefined && costAmount === undefined) {
      return;
    }

    this.usage = {
      ...(used !== undefined ? { used } : {}),
      ...(size !== undefined ? { size } : {}),
      ...(costAmount !== undefined ? { costAmount } : {}),
      ...(costCurrency ? { costCurrency } : {})
    };
    this.post({ type: "usage", usage: this.usage });
  }

  private syncCurrentMode(modeId: string): void {
    this.currentModeId = modeId;
    this.record.currentModeId = modeId;
    const hasExplicitModeOption = this.configOptions.some(
      (opt) => opt.type === "select" && (opt.category === "mode" || opt.id === "mode")
    );
    this.configOptions = this.configOptions.map((opt) => {
      if (opt.type !== "select") {
        return opt;
      }
      if (opt.category === "mode" || opt.id === "mode") {
        return { ...opt, currentValue: modeId };
      }
      if (
        !hasExplicitModeOption &&
        opt.category === "thought_level" &&
        opt.options.some((choice) => choice.value === modeId)
      ) {
        return { ...opt, currentValue: modeId };
      }
      return opt;
    });
  }

  private handleAgentChunk(update: Record<string, unknown>, channel: "text" | "thinking"): void {
    const delta = extractTextFromContent(update.content);
    if (!delta || !this.turnAssistantId) {
      return;
    }

    if (!this.streamingAssistantId) {
      this.streamingAssistantId = this.turnAssistantId;
      this.streamingText = "";
      this.streamingThinking = "";
    }

    if (channel === "thinking") {
      this.streamingThinking += delta;
    } else {
      this.streamingText += delta;
    }

    this.postAssistantUpdate(this.getAssistantMessage(this.turnAssistantId));
  }

  private getAssistantMessage(id: string): AcpChatMessage {
    const existing = this.messages.find((entry) => entry.id === id);
    if (existing) {
      if (id === this.streamingAssistantId) {
        return {
          ...existing,
          text: this.streamingText || existing.text,
          thinking: this.streamingThinking || existing.thinking
        };
      }
      return existing;
    }
    return {
      id,
      role: "assistant",
      text: id === this.streamingAssistantId ? this.streamingText : "",
      thinking: id === this.streamingAssistantId && this.streamingThinking ? this.streamingThinking : undefined,
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
    if (this.streamingAssistantId === assistant.id) {
      if (this.streamingText) {
        assistant.text = this.streamingText;
      }
      if (this.streamingThinking) {
        assistant.thinking = this.streamingThinking;
      }
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
        thinking: assistant.thinking ?? "",
        toolCalls: assistant.toolCalls ?? [],
        streaming: true
      });
      return;
    }

    this.post({ type: "messageUpdate", message: this.enrichMessageForWebview(assistant) });
  }

  private handlePlan(update: Record<string, unknown>): void {
    const planEntries = parsePlanEntries(update);
    const text = formatPlanText(update);
    if (!planEntries.length && !text) {
      return;
    }

    const planId =
      typeof update.planId === "string" && update.planId
        ? `plan:${update.planId}`
        : (this.turnPlanMessageId ??= crypto.randomUUID());

    const existing = this.messages.find((entry) => entry.id === planId);
    const message: AcpChatMessage = {
      id: planId,
      role: "plan",
      text,
      ...(planEntries.length ? { planEntries } : {}),
      timestamp: existing?.timestamp ?? Date.now()
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
        if (this.availableCommands.length) {
          this.post({ type: "commands", commands: this.availableCommands });
        }
        if (this.usage) {
          this.post({ type: "usage", usage: this.usage });
        }
        return;
      case "send":
        await this.sendMessage(message.text ?? "", message.images ?? []);
        return;
      case "stop":
        this.cancelledByUser = true;
        if (this.activeAcpSessionId && this.connection) {
          try {
            await this.connection.cancel(this.activeAcpSessionId);
          } catch {
            // Best-effort cancel notification.
          }
        }
        this.abortController?.abort();
        this.isRunning = false;
        this.finalizeStreamingAssistant();
        this.post({ type: "status", status: "ready", isRunning: false, isConnecting: false });
        return;
      case "setMode":
        await this.setMode(message.modeId ?? "");
        return;
      case "setConfigOption":
        await this.setConfigOption(message);
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
      case "openFile":
        if (message.path) {
          await this.openWorkspaceFile(message.path, message.line);
        }
        return;
      case "copyText":
        if (typeof message.text === "string") {
          await vscode.env.clipboard.writeText(message.text);
        }
        return;
    }
  }

  private async openWorkspaceFile(filePath: string, line?: number): Promise<void> {
    try {
      const { cwd } = this.resolveWorkingDirectory();
      const resolved = path.isAbsolute(filePath)
        ? filePath
        : path.resolve(cwd, filePath);
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(resolved));
      const zeroLine = Math.max(0, (typeof line === "number" ? line : 1) - 1);
      const pos = new vscode.Position(zeroLine, 0);
      await vscode.window.showTextDocument(doc, {
        viewColumn: vscode.ViewColumn.One,
        selection: new vscode.Range(pos, pos),
        preserveFocus: false
      });
    } catch (error) {
      this.post({ type: "error", message: `Failed to open ${filePath}: ${formatError(error)}` });
    }
  }

  private async setMode(modeId: string): Promise<void> {
    if (!modeId || !this.connection || !this.activeAcpSessionId || this.isRunning) {
      return;
    }

    try {
      await this.connection.setMode(this.activeAcpSessionId, modeId);
      this.syncCurrentMode(modeId);
      this.record.updatedAt = Date.now();
      await updateAcpRecord(this.panelHome, this.record);
      this.postInit();
    } catch (error) {
      this.post({ type: "error", message: `Mode switch failed: ${formatError(error)}` });
    }
  }

  private async setConfigOption(payload: WebviewSendPayload): Promise<void> {
    const configId = payload.configId;
    if (!configId || payload.value === undefined || !this.connection || !this.activeAcpSessionId || this.isRunning) {
      return;
    }

    if (payload.source === "mode") {
      await this.setMode(String(payload.value));
      return;
    }

    const valueType = payload.valueType === "boolean" ? "boolean" : "select";

    try {
      let updated: AcpConfigOption[] | null = null;
      if (payload.source === "model") {
        try {
          updated = await this.connection.setConfigOption(
            this.activeAcpSessionId,
            configId,
            payload.value,
            "select"
          );
        } catch {
          await this.connection.setMode(this.activeAcpSessionId, String(payload.value));
        }
      } else {
        updated = await this.connection.setConfigOption(
          this.activeAcpSessionId,
          configId,
          payload.value,
          valueType
        );
      }

      if (updated) {
        const hasMode = updated.some((opt) => opt.category === "mode" || opt.id === "mode");
        const hasModel = updated.some((opt) => opt.category === "model" || opt.id === "model");
        const preservedLegacy = this.configOptions.filter(
          (opt) => (opt.source === "mode" && !hasMode) || (opt.source === "model" && !hasModel)
        );
        this.configOptions = sortConfigOptions([...updated, ...preservedLegacy]);
      } else {
        this.configOptions = this.configOptions.map((opt) => {
          if (opt.id !== configId) {
            return opt;
          }
          if (opt.type === "boolean" && valueType === "boolean") {
            return { ...opt, currentValue: Boolean(payload.value) };
          }
          if (opt.type === "select" && valueType === "select") {
            return { ...opt, currentValue: String(payload.value) };
          }
          return opt;
        });
      }

      const modeOpt = this.configOptions.find(
        (opt): opt is Extract<AcpConfigOption, { type: "select" }> =>
          opt.type === "select" && (opt.category === "mode" || opt.id === "mode")
      );
      if (modeOpt && modeOpt.currentValue) {
        this.currentModeId = modeOpt.currentValue;
        this.record.currentModeId = modeOpt.currentValue;
      }

      this.record.updatedAt = Date.now();
      await updateAcpRecord(this.panelHome, this.record);
      this.postInit();
    } catch (error) {
      this.post({ type: "error", message: `Config switch failed: ${formatError(error)}` });
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
    this.cancelledByUser = false;
    this.abortController = new AbortController();
    this.turnAssistantId = crypto.randomUUID();
    this.turnPlanMessageId = undefined;
    this.streamingAssistantId = undefined;
    this.streamingText = "";
    this.streamingThinking = "";
    this.post({ type: "status", status: "thinking", isRunning: true, isConnecting: false });

    const turnId = this.turnAssistantId;
    try {
      const blocks = await this.buildPromptBlocks(text, savedImages);
      await this.connection.prompt(this.activeAcpSessionId, blocks);
      await this.drainSessionUpdates();
      this.finalizeStreamingAssistant();
      if (
        !this.cancelledByUser &&
        turnId &&
        !this.messages.some((entry) => entry.role === "assistant" && entry.id === turnId)
      ) {
        const providerName = PROVIDER_LABELS[this.record.provider] || this.record.provider;
        this.post({
          type: "error",
          message: `${providerName} returned an empty response. Try again or check agent permissions.`
        });
      }
      this.record.updatedAt = Date.now();
      await updateAcpRecord(this.panelHome, this.record);
      await this.reloadTree();
    } catch (error) {
      if (this.abortController.signal.aborted || this.cancelledByUser) {
        this.finalizeStreamingAssistant();
        this.post({ type: "status", status: "stopped", isRunning: false, isConnecting: false });
        return;
      }
      this.post({ type: "error", message: formatError(error) });
    } finally {
      this.isRunning = false;
      this.abortController = undefined;
      this.turnPlanMessageId = undefined;
      this.post({ type: "status", status: "ready", isRunning: false, isConnecting: false });
      await this.flushExternalStoreRefresh();
    }
  }

  private finalizeStreamingAssistant(): void {
    const turnId = this.streamingAssistantId ?? this.turnAssistantId;
    if (!turnId) {
      this.streamingText = "";
      this.streamingThinking = "";
      return;
    }

    const index = this.messages.findIndex((entry) => entry.id === turnId);
    const existing = index >= 0 ? this.messages[index] : undefined;
    const text = this.streamingText.trim() || existing?.text?.trim() || "";
    const thinking = this.streamingThinking.trim() || existing?.thinking?.trim() || "";
    const toolCalls = existing?.toolCalls;

    if (!text && !thinking && !toolCalls?.length) {
      if (index >= 0) {
        this.messages.splice(index, 1);
      }
      this.streamingAssistantId = undefined;
      this.turnAssistantId = undefined;
      this.streamingText = "";
      this.streamingThinking = "";
      return;
    }

    const assistantMessage: AcpChatMessage = {
      id: turnId,
      role: "assistant",
      text,
      ...(thinking ? { thinking } : {}),
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
    this.streamingThinking = "";
  }

  private postInit(): void {
    const iconMap = buildWebviewAgentIconMap(this.panel.webview, this.context.extensionUri);
    this.post({
      type: "init",
      init: {
        chatId: this.record.id,
        title: this.record.title,
        projectPath: this.record.projectPath,
        provider: this.record.provider,
        providerLabel: PROVIDER_LABELS[this.record.provider] || this.record.provider,
        agentIcon: iconMap[this.record.provider],
        acpSessionId: this.record.acpSessionId,
        modes: this.availableModes,
        modeId: this.currentModeId,
        configOptions: this.configOptions,
        commands: this.availableCommands,
        usage: this.usage,
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
    const providerLabel = PROVIDER_LABELS[this.record.provider] || this.record.provider;
    return `ACP ${providerLabel}${mode}: ${truncate(this.record.title, 28)}`;
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
      <img id="header-icon" class="header-icon" alt="" hidden>
      <div class="header-text">
        <div class="header-title-row">
          <div id="header-title">ACP Chat</div>
          <span id="status-pill" class="status-pill connecting">
            <span id="status-dot" class="status-dot connecting" aria-hidden="true"></span>
            <span id="status-label">connecting</span>
          </span>
        </div>
        <div id="header-meta"></div>
      </div>
    </div>
    <div class="header-actions">
      <span id="header-usage" class="header-usage" hidden></span>
      <button id="reconnect" class="icon-btn" type="button" title="Reconnect" aria-label="Reconnect">
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M13.5 2v4h-4l1.45-1.45A4.5 4.5 0 1 0 12.4 9.5h1.53A6 6 0 1 1 12 3.5L13.5 2z"/></svg>
      </button>
    </div>
  </header>
  <main id="messages" class="chat-messages">
    <div id="empty-state" class="empty-state" hidden></div>
    <div id="messages-inner" class="chat-thread"></div>
  </main>
  <button id="scroll-bottom" class="scroll-bottom-btn" type="button" hidden title="Scroll to bottom" aria-label="Scroll to bottom">
    <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 12.2 2.8 7l1.06-1.06L7.25 9.33V2h1.5v7.33l3.39-3.39L13.2 7 8 12.2z"/></svg>
  </button>
  <footer id="composer" class="composer-wrap">
    <div id="composer-card" class="composer-card">
      <div id="slash-menu" class="slash-menu" hidden role="listbox"></div>
      <div id="pending-images" class="pending-images" hidden></div>
      <textarea id="input" rows="1" placeholder="Message the agent…" aria-label="Message"></textarea>
      <div class="composer-toolbar">
        <div class="composer-controls">
          <button id="attach" type="button" class="toolbar-icon-btn" hidden title="Attach image" aria-label="Attach image">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16.5 6v11.5a4 4 0 0 1-8 0V5a2.5 2.5 0 0 1 5 0v10.5a1 1 0 0 1-2 0V6h-1.5v9.5a2.5 2.5 0 0 0 5 0V5a4 4 0 0 0-8 0v12.5a5.5 5.5 0 0 0 11 0V6z"/></svg>
          </button>
          <input id="file-input" type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden>
          <button id="slash-trigger" type="button" class="toolbar-icon-btn" hidden title="Slash commands" aria-label="Slash commands">/</button>
          <div id="config-controls" class="config-controls"></div>
        </div>
        <div class="composer-actions">
          <button id="send-stop" type="button" class="send-stop-btn" aria-label="Send" title="Send">
            <svg class="icon-send" viewBox="0 0 24 24" aria-hidden="true"><path d="M2.01 21 23 12 2.01 3 2 10l15 2-15 2z"/></svg>
            <svg class="icon-stop" viewBox="0 0 16 16" aria-hidden="true"><rect x="3.5" y="3.5" width="9" height="9" rx="1.5"/></svg>
          </button>
        </div>
      </div>
    </div>
  </footer>
  <div id="image-lightbox" class="image-lightbox" hidden role="dialog" aria-modal="true">
    <img id="image-lightbox-img" alt="">
  </div>
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

function parsePlanEntries(update: Record<string, unknown>): AcpPlanEntry[] {
  if (!Array.isArray(update.entries)) {
    return [];
  }

  const entries: AcpPlanEntry[] = [];
  for (const item of update.entries) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const step = item as { content?: unknown; status?: unknown; priority?: unknown };
    const content = typeof step.content === "string" ? step.content.trim() : "";
    if (!content) {
      continue;
    }
    const status =
      step.status === "completed" || step.status === "in_progress" ? step.status : "pending";
    const entry: AcpPlanEntry = { content, status };
    if (typeof step.priority === "string" && step.priority) {
      entry.priority = step.priority;
    }
    entries.push(entry);
  }
  return entries;
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

function isExistingDirectory(dirPath: string): boolean {
  try {
    return fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory();
  } catch {
    return false;
  }
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
