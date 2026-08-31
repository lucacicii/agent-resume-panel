import * as crypto from "node:crypto";
import type { BrowserWindow } from "electron";
import { shell } from "electron";
import type { PanelSettings } from "@agent-resume/core";
import { effectivePanelHome, extractPreviewContent } from "@agent-resume/core";
import type { RequestPermissionRequest, RequestPermissionResponse } from "@agentclientprotocol/sdk" with {
  "resolution-mode": "import"
};
import { safeHandle } from "../ipcUtils";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import {
  AcpAgentConnection,
  formatAcpError,
  parseConfigOptions,
  type AcpPromptBlock,
  type AcpSessionModes,
  type SessionMeta
} from "./agentConnection";
import { autoApprovePermissions, experimentalGrokVendorUi } from "./config";
import {
  GROK_MODEL_CONFIG_ID,
  GROK_REASONING_EFFORT_CONFIG_ID,
  applyGrokVendorSessionMeta,
  isGrokVendorConfigId,
  setGrokModel,
  setGrokReasoningEffort
} from "./vendors/grok";
import {
  makeAcceptedQuestionResponse,
  makeCancelledQuestionResponse,
  setAskUserQuestionHandler,
  type AskUserQuestionRequest,
  type AskUserQuestionResponse
} from "./handlers/askUserQuestion";
import { readPlanFile, setPlanWriteListener } from "./handlers/fs";
import { setPermissionPromptHandler } from "./handlers/permission";
import { clearSessionUpdateListeners, subscribeSessionUpdates } from "./sessionUpdateBus";
import {
  appendAcpMessage,
  createAcpRecord,
  deleteAcpRecord,
  getAcpRecord,
  loadAcpMessages,
  loadAcpRecords,
  readAcpImageBase64,
  resolveAcpFileAbsolutePath,
  saveAcpFileAttachments,
  saveAcpImageAttachments,
  updateAcpRecord,
  validateIncomingFiles,
  validateIncomingImages,
  type IncomingAcpFile,
  type IncomingAcpImage
} from "./store";
import type {
  AcpAgentProvider,
  AcpAvailableCommand,
  AcpChatMessage,
  AcpConfigOption,
  AcpFileAttachment,
  AcpImageAttachment,
  AcpMode,
  AcpModelsState,
  AcpSessionRecord,
  AcpStreamEvent,
  AcpToolCallInfo,
  AcpToolCallLocation,
  AcpToolCallStatus
} from "./types";

type LoadSettings = () => Promise<PanelSettings>;
type GetMainWindow = () => BrowserWindow | null;

const controllers = new Map<string, AcpChatController>();
let lastActiveChatId: string | null = null;
const permissionWaiters = new Map<
  string,
  { resolve: (value: RequestPermissionResponse) => void; chatId: string }
>();
/** Grok ask_user_question waiters — default timeout 30 minutes (Grok CLI default). */
const QUESTION_TIMEOUT_MS = 30 * 60 * 1000;
const questionWaiters = new Map<
  string,
  { resolve: (value: AskUserQuestionResponse) => void; chatId: string }
>();

class AcpChatController {
  private connection?: AcpAgentConnection;
  private messages: AcpChatMessage[] = [];
  private isRunning = false;
  private isConnecting = false;
  private availableModes: AcpMode[] = [];
  private currentModeId?: string;
  private models: AcpModelsState | null = null;
  private configOptions: AcpConfigOption[] = [];
  private availableCommands: AcpAvailableCommand[] = [];
  private unsubscribeSessionUpdates?: () => void;
  private streamingAssistantId?: string;
  private turnAssistantId?: string;
  private streamingText = "";
  private streamingThinking = "";
  private activeAcpSessionId?: string;
  private isReplayingLoadedHistory = false;
  private historyReplayDone?: () => void;
  private abortController?: AbortController;

  constructor(
    private record: AcpSessionRecord,
    private readonly panelHome: string,
    private readonly settings: PanelSettings,
    private readonly emit: (event: AcpStreamEvent) => void
  ) {}

  getRecord(): AcpSessionRecord {
    return this.record;
  }

  getActiveAcpSessionId(): string | undefined {
    return this.activeAcpSessionId;
  }

  /** Agent process is up and we have an ACP session id (safe to reuse across tab switches). */
  isLive(): boolean {
    return Boolean(
      this.connection?.isLive() && this.activeAcpSessionId && !this.isConnecting
    );
  }

  /**
   * Re-push history + init + status without respawning the agent.
   * Used when the renderer re-activates an already-connected chat.
   */
  repostSnapshot(): void {
    this.emit({ type: "history", chatId: this.record.id, messages: this.messages });
    this.postInit();
    if (!this.isConnecting) {
      this.status(
        this.isRunning ? "running" : this.connection?.isLive() ? "ready" : "error",
        this.isRunning,
        false
      );
    }
  }

  async bootstrap(): Promise<void> {
    this.messages = migrateLegacyToolMessages(await loadAcpMessages(this.panelHome, this.record.id));
    this.emit({ type: "history", chatId: this.record.id, messages: this.messages });
    await this.ensureAgentSession();
    this.postInit();
  }

  private postInit(): void {
    this.emit({
      type: "init",
      chatId: this.record.id,
      init: {
        title: this.record.title,
        projectPath: this.record.projectPath,
        provider: this.record.provider,
        acpSessionId: this.record.acpSessionId,
        modes: this.availableModes,
        modeId: this.currentModeId,
        models: this.models,
        modelId: this.models?.currentModelId,
        configOptions: this.configOptions,
        availableCommands: this.availableCommands,
        isRunning: this.isRunning,
        isConnecting: this.isConnecting,
        status: this.isConnecting ? "connecting" : this.isRunning ? "running" : "ready",
        imageUpload: this.connection?.supportsImageUpload() ?? false,
        embeddedContext: this.connection?.supportsEmbeddedContext() ?? false,
        fileUpload: Boolean(this.connection)
      }
    });
  }

  private status(status: string, isRunning: boolean, isConnecting: boolean): void {
    this.emit({
      type: "status",
      chatId: this.record.id,
      status,
      isRunning,
      isConnecting
    });
  }

  async ensureAgentSession(): Promise<void> {
    if (this.isConnecting) return;
    this.isConnecting = true;
    this.status("connecting", false, true);

    try {
      if (this.activeAcpSessionId) clearSessionUpdateListeners(this.activeAcpSessionId);
      this.unsubscribeSessionUpdates?.();
      this.unsubscribeSessionUpdates = undefined;
      this.connection?.dispose();
      this.connection = new AcpAgentConnection(this.record.provider, this.settings, this.record.projectPath);

      if (this.record.acpSessionId) {
        const previousSessionId = this.record.acpSessionId;
        this.activeAcpSessionId = previousSessionId;
        this.isReplayingLoadedHistory = false;
        try {
          const result = await this.connection.restoreSession(
            previousSessionId,
            this.record.projectPath,
            this.record.id
          );
          if (result.sessionId !== previousSessionId) {
            clearSessionUpdateListeners(previousSessionId);
            this.record.acpSessionId = result.sessionId;
            this.activeAcpSessionId = result.sessionId;
            this.record.updatedAt = Date.now();
            await updateAcpRecord(this.panelHome, this.record);
          }
          this.applySessionMetaFromResult(result);
          if (result.method === "load") {
            this.isReplayingLoadedHistory = true;
            await this.waitForHistoryReplay();
          }
        } finally {
          this.isReplayingLoadedHistory = false;
          this.historyReplayDone = undefined;
        }
      } else {
        const result = await this.connection.startSession(this.record.projectPath, this.record.id);
        this.record.acpSessionId = result.sessionId;
        this.activeAcpSessionId = result.sessionId;
        this.applySessionMetaFromResult(result);
        this.record.updatedAt = Date.now();
        await updateAcpRecord(this.panelHome, this.record);
      }

      this.setupSessionUpdates();
      this.status("ready", false, false);
    } catch (error) {
      const message = `Failed to connect to ${this.record.provider} agent: ${formatError(error)}`;
      this.emit({
        type: "error",
        chatId: this.record.id,
        message
      });
      this.status("error", false, false);
      // Re-throw so acp:connect fails the IPC invoke — renderer must not treat a
      // failed agent spawn/handshake as a successful connect (avoids stuck/false ready).
      throw new Error(message);
    } finally {
      this.isConnecting = false;
      this.postInit();
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

  private applySessionMetaFromResult(result: SessionMeta & { raw?: Record<string, unknown> }): void {
    let meta: SessionMeta = {
      modes: result.modes ?? null,
      models: result.models ?? null,
      configOptions: Array.isArray(result.configOptions) ? result.configOptions : []
    };
    if (
      this.record.provider === "grok" &&
      experimentalGrokVendorUi(this.settings) &&
      result.raw
    ) {
      meta = applyGrokVendorSessionMeta(result.raw, meta);
    }
    this.applySessionMeta(meta);
  }

  private applySessionMeta(meta: {
    modes?: AcpSessionModes | null;
    models?: AcpModelsState | null;
    configOptions?: AcpConfigOption[] | null;
  }): void {
    if (meta.modes) {
      this.availableModes = meta.modes.availableModes ?? [];
      this.currentModeId = meta.modes.currentModeId ?? this.availableModes[0]?.id;
      if (this.currentModeId) this.record.currentModeId = this.currentModeId;
    } else {
      this.availableModes = [];
      this.currentModeId = undefined;
    }
    this.models = meta.models ?? null;
    if (Array.isArray(meta.configOptions)) {
      this.configOptions = meta.configOptions;
    }
  }

  private setupSessionUpdates(): void {
    if (!this.activeAcpSessionId) return;
    this.unsubscribeSessionUpdates?.();
    this.unsubscribeSessionUpdates = subscribeSessionUpdates(this.activeAcpSessionId, (payload) => {
      this.handleSessionUpdate(payload.update);
    });
  }

  private handleSessionUpdate(update: Record<string, unknown>): void {
    const kind = update.sessionUpdate;
    if (typeof kind !== "string") return;

    if (this.isReplayingLoadedHistory) {
      if (kind === "available_commands_update") this.historyReplayDone?.();
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
      case "available_commands_update":
        this.availableCommands = parseAvailableCommands(update.availableCommands);
        this.postInit();
        break;
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
      case "model_changed": {
        // Grok vendor notification: { model_id, reasoning_effort }
        const modelId =
          typeof update.model_id === "string"
            ? update.model_id
            : typeof update.modelId === "string"
              ? update.modelId
              : "";
        const effort =
          typeof update.reasoning_effort === "string"
            ? update.reasoning_effort
            : typeof update.reasoningEffort === "string"
              ? update.reasoningEffort
              : "";
        if (modelId && this.models) {
          this.models = { ...this.models, currentModelId: modelId };
          this.patchConfigLocally(GROK_MODEL_CONFIG_ID, modelId);
          // Also patch any official model config option by category.
          const modelOpt = this.configOptions.find(
            (option) => option.type === "select" && option.category === "model"
          );
          if (modelOpt) this.patchConfigLocally(modelOpt.id, modelId);
        }
        if (effort) {
          this.patchConfigLocally(GROK_REASONING_EFFORT_CONFIG_ID, effort);
          const thoughtOpt = this.configOptions.find(
            (option) => option.type === "select" && option.category === "thought_level"
          );
          if (thoughtOpt) this.patchConfigLocally(thoughtOpt.id, effort);
        }
        if (modelId || effort) this.postInit();
        break;
      }
      case "config_option_update":
      case "config_options_update":
      case "session_info_update": {
        const options = parseConfigOptions(update.configOptions);
        if (options.length || Array.isArray(update.configOptions)) {
          this.configOptions = options;
          this.postInit();
        }
        break;
      }
    }
  }

  private handleAgentChunk(update: Record<string, unknown>): void {
    const extracted = extractPreviewContent(update.content);
    if (!extracted.text && !extracted.thinking) return;
    if (!this.turnAssistantId) return;
    if (!this.streamingAssistantId) {
      this.streamingAssistantId = this.turnAssistantId;
      this.streamingText = extracted.text;
      this.streamingThinking = extracted.thinking;
    } else {
      if (extracted.text) this.streamingText += (this.streamingText ? "" : "") + extracted.text;
      if (extracted.thinking) this.streamingThinking += (this.streamingThinking ? "" : "") + extracted.thinking;
    }
    const assistant = this.getAssistantMessage(this.turnAssistantId);
    assistant.text = this.streamingText;
    assistant.thinking = this.streamingThinking || undefined;
    this.postAssistantUpdate(assistant);
  }

  private getAssistantMessage(id: string): AcpChatMessage {
    const existing = this.messages.find((entry) => entry.id === id);
    if (existing) return existing;
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
    if (!turnId) throw new Error("No active assistant turn.");
    if (!this.streamingAssistantId) this.streamingAssistantId = turnId;
    const index = this.messages.findIndex((entry) => entry.id === turnId);
    if (index >= 0) return this.messages[index]!;
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
    if (!this.turnAssistantId) return;
    const assistant = this.ensureTurnAssistantMessage();
    const toolCalls = [...(assistant.toolCalls ?? [])];
    const index = toolCalls.findIndex((entry) => entry.toolCallId === incoming.toolCallId);
    if (index >= 0) toolCalls[index] = mergeToolCallInfo(toolCalls[index]!, incoming);
    else toolCalls.push(incoming);
    assistant.toolCalls = toolCalls;
    if (this.streamingText && this.streamingAssistantId === assistant.id) {
      assistant.text = this.streamingText;
    }
    const messageIndex = this.messages.findIndex((entry) => entry.id === assistant.id);
    if (messageIndex >= 0) this.messages[messageIndex] = assistant;
    this.postAssistantUpdate(assistant);
  }

  private postAssistantUpdate(assistant: AcpChatMessage): void {
    const streaming = this.isRunning && this.streamingAssistantId === assistant.id;
    if (streaming) {
      this.emit({
        type: "assistantDelta",
        chatId: this.record.id,
        id: assistant.id,
        text: assistant.text,
        thinking: assistant.thinking,
        toolCalls: assistant.toolCalls ?? [],
        streaming: true
      });
      return;
    }
    this.emit({ type: "messageUpdate", chatId: this.record.id, message: assistant });
  }

  private handlePlan(update: Record<string, unknown>): void {
    const text = formatPlanText(update);
    if (!text) return;
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
      this.emit({ type: "messageUpdate", chatId: this.record.id, message });
    } else {
      this.messages.push(message);
      this.emit({ type: "message", chatId: this.record.id, message });
    }
    void appendAcpMessage(this.panelHome, this.record.id, message);
  }

  async sendMessage(
    rawText: string,
    rawImages: IncomingAcpImage[] = [],
    rawFiles: IncomingAcpFile[] = []
  ): Promise<void> {
    const text = rawText.trim();
    let images = rawImages.filter((image) => image.data);
    const files = rawFiles.filter((file) => file.absolutePath?.trim() || file.data);
    if (
      (!text && !images.length && !files.length) ||
      this.isRunning ||
      this.isConnecting ||
      !this.connection ||
      !this.activeAcpSessionId
    ) {
      return;
    }

    if (images.length) {
      const validationError = validateIncomingImages(images);
      if (validationError) {
        this.emit({ type: "error", chatId: this.record.id, message: validationError });
        return;
      }
      // Prefer native image blocks when supported; otherwise treat as generic files below.
      if (!this.connection.supportsImageUpload()) {
        for (const image of images) {
          files.push({
            mimeType: image.mimeType,
            fileName: image.fileName,
            data: image.data
          });
        }
        images = [];
      }
    }

    if (files.length) {
      const validationError = validateIncomingFiles(files);
      if (validationError) {
        this.emit({ type: "error", chatId: this.record.id, message: validationError });
        return;
      }
    }

    const messageId = crypto.randomUUID();
    const savedImages = images.length
      ? await saveAcpImageAttachments(this.panelHome, this.record.id, messageId, images)
      : undefined;
    const savedFiles = files.length
      ? await saveAcpFileAttachments(this.panelHome, this.record.id, messageId, files)
      : undefined;

    const userMessage: AcpChatMessage = {
      id: messageId,
      role: "user",
      text,
      timestamp: Date.now(),
      images: savedImages,
      files: savedFiles
    };
    this.messages.push(userMessage);
    await appendAcpMessage(this.panelHome, this.record.id, userMessage);
    this.emit({ type: "message", chatId: this.record.id, message: userMessage });

    if (this.record.title === "New ACP Chat") {
      const titleSource =
        text || savedImages?.[0]?.fileName || savedFiles?.[0]?.fileName || "Attachment";
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
    this.streamingThinking = "";
    this.status("thinking", true, false);

    const turnId = this.turnAssistantId;
    try {
      const blocks = await this.buildPromptBlocks(text, savedImages, savedFiles);
      await this.connection.prompt(this.activeAcpSessionId, blocks);
      await new Promise((resolve) => setTimeout(resolve, 200));
      this.finalizeStreamingAssistant();
      if (turnId && !this.messages.some((entry) => entry.role === "assistant" && entry.id === turnId)) {
        this.emit({
          type: "error",
          chatId: this.record.id,
          message: "Agent returned an empty response. Try again or check agent permissions."
        });
      }
      this.record.updatedAt = Date.now();
      await updateAcpRecord(this.panelHome, this.record);
    } catch (error) {
      if (this.abortController.signal.aborted) {
        this.finalizeStreamingAssistant();
        this.status("stopped", false, false);
        return;
      }
      this.emit({ type: "error", chatId: this.record.id, message: formatError(error) });
    } finally {
      this.isRunning = false;
      this.abortController = undefined;
      this.status("ready", false, false);
      this.postInit();
    }
  }

  async cancel(): Promise<void> {
    if (this.activeAcpSessionId && this.connection) {
      try {
        await this.connection.cancel(this.activeAcpSessionId);
      } catch {
        // ignore cancel failures
      }
    }
    this.abortController?.abort();
    this.isRunning = false;
    this.finalizeStreamingAssistant();
    this.status("ready", false, false);
    this.postInit();
  }

  async setMode(modeId: string): Promise<void> {
    if (!modeId || !this.connection || !this.activeAcpSessionId || this.isRunning) return;
    try {
      await this.connection.setMode(this.activeAcpSessionId, modeId);
      this.currentModeId = modeId;
      this.record.currentModeId = modeId;
      this.record.updatedAt = Date.now();
      await updateAcpRecord(this.panelHome, this.record);
      this.postInit();
    } catch (error) {
      this.emit({ type: "error", chatId: this.record.id, message: `Mode switch failed: ${formatError(error)}` });
    }
  }

  async setModel(modelId: string): Promise<void> {
    if (!modelId) return;
    const modelOpt = this.configOptions.find(
      (option) => option.type === "select" && (option.category === "model" || option.id === "model" || option.id === "model_id")
    );
    if (modelOpt && modelOpt.type === "select") {
      if (modelOpt.currentValue !== modelId) {
        await this.setConfigOption(modelOpt.id, modelId);
      }
    } else {
      await this.setConfigOption("model", modelId);
    }
  }

  async setConfigOption(configId: string, value: string | boolean): Promise<void> {
    if (!configId || !this.connection || !this.activeAcpSessionId || this.isRunning) return;
    try {
      // Experimental Grok vendor routing (kill-switchable).
      if (
        this.record.provider === "grok" &&
        experimentalGrokVendorUi(this.settings) &&
        typeof value === "string" &&
        isGrokVendorConfigId(configId)
      ) {
        if (configId === GROK_REASONING_EFFORT_CONFIG_ID) {
          const modelOpt = this.configOptions.find(
            (option) => option.type === "select" && option.category === "model"
          );
          const modelId =
            this.models?.currentModelId ||
            (modelOpt?.type === "select" ? modelOpt.currentValue : "") ||
            "";
          await setGrokReasoningEffort(
            (method, params) => this.connection!.requestRaw(method, params),
            this.activeAcpSessionId,
            value,
            modelId
          );
        } else if (configId === GROK_MODEL_CONFIG_ID) {
          await setGrokModel(
            (method, params) => this.connection!.requestRaw(method, params),
            this.activeAcpSessionId,
            value
          );
          if (this.models) this.models = { ...this.models, currentModelId: value };
        } else {
          throw new Error(`Unknown Grok vendor config: ${configId}`);
        }
        this.patchConfigLocally(configId, value);
        this.record.updatedAt = Date.now();
        await updateAcpRecord(this.panelHome, this.record);
        this.postInit();
        return;
      }

      try {
        const next = await this.connection.setConfigOption(this.activeAcpSessionId, configId, value);
        if (next.length) {
          this.configOptions = next;
        } else {
          this.patchConfigLocally(configId, value);
        }
      } catch (error) {
        // Fallback: Grok model via set_model when standard method missing.
        if (
          this.record.provider === "grok" &&
          experimentalGrokVendorUi(this.settings) &&
          typeof value === "string" &&
          this.models?.availableModels.some((model) => model.modelId === value)
        ) {
          await setGrokModel(
            (method, params) => this.connection!.requestRaw(method, params),
            this.activeAcpSessionId,
            value
          );
          if (this.models) this.models = { ...this.models, currentModelId: value };
        } else {
          throw error;
        }
      }
      this.record.updatedAt = Date.now();
      await updateAcpRecord(this.panelHome, this.record);
      this.postInit();
    } catch (error) {
      this.emit({
        type: "error",
        chatId: this.record.id,
        message: `Config update failed: ${formatError(error)}`
      });
      this.postInit();
    }
  }

  private patchConfigLocally(configId: string, value: string | boolean): void {
    this.configOptions = this.configOptions.map((option) => {
      if (option.id !== configId) return option;
      if (option.type === "boolean" && typeof value === "boolean") {
        return { ...option, currentValue: value };
      }
      if (option.type === "select" && typeof value === "string") {
        return { ...option, currentValue: value };
      }
      return option;
    });
    if (this.models && typeof value === "string") {
      const modelOpt = this.configOptions.find(
        (option) => option.id === configId && option.type === "select" && option.category === "model"
      );
      if (modelOpt) {
        this.models = { ...this.models, currentModelId: value };
      }
    }
  }

  async rename(title: string): Promise<AcpSessionRecord> {
    const next = title.trim();
    if (!next) return this.record;
    this.record.title = next;
    this.record.updatedAt = Date.now();
    await updateAcpRecord(this.panelHome, this.record);
    this.postInit();
    return this.record;
  }

  async setProjectPath(projectPath: string): Promise<AcpSessionRecord> {
    const next = projectPath.trim();
    if (!next || this.record.projectPath === next) return this.record;
    this.record.projectPath = next;
    this.record.updatedAt = Date.now();
    await updateAcpRecord(this.panelHome, this.record);
    this.postInit();
    return this.record;
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
    const thinking = this.streamingThinking.trim() || existing?.thinking?.trim() || undefined;
    const toolCalls = existing?.toolCalls;
    if (!text && !thinking && !toolCalls?.length) {
      if (index >= 0) this.messages.splice(index, 1);
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
      thinking,
      timestamp: existing?.timestamp ?? Date.now(),
      toolCalls: toolCalls?.length ? toolCalls : undefined
    };
    if (index >= 0) this.messages[index] = assistantMessage;
    else this.messages.push(assistantMessage);
    void appendAcpMessage(this.panelHome, this.record.id, assistantMessage);
    this.emit({
      type: "assistantDone",
      chatId: this.record.id,
      message: assistantMessage,
      streaming: false
    });
    this.streamingAssistantId = undefined;
    this.turnAssistantId = undefined;
    this.streamingText = "";
    this.streamingThinking = "";
  }

  private async buildPromptBlocks(
    text: string,
    images?: AcpImageAttachment[],
    files?: AcpFileAttachment[]
  ): Promise<AcpPromptBlock[]> {
    const blocks: AcpPromptBlock[] = [];
    for (const image of images ?? []) {
      blocks.push({
        type: "image",
        mimeType: image.mimeType,
        data: await readAcpImageBase64(this.panelHome, image)
      });
    }
    for (const file of files ?? []) {
      const absolute = resolveAcpFileAbsolutePath(this.panelHome, file);
      const uri = absolute ? pathToFileURL(absolute).href : `file:///${encodeURIComponent(file.fileName)}`;
      const useEmbedded =
        this.connection?.supportsEmbeddedContext() &&
        Boolean(file.storagePath) &&
        !file.absolutePath;
      if (useEmbedded && file.storagePath) {
        const buffer = await fs.readFile(path.join(this.panelHome, file.storagePath!));
        const isText =
          file.mimeType.startsWith("text/") ||
          file.mimeType === "application/json" ||
          file.mimeType === "application/xml" ||
          /\.(md|txt|json|csv|ts|tsx|js|jsx|py|rs|go|java|c|cpp|h|css|html|yml|yaml|toml|sh)$/i.test(
            file.fileName
          );
        if (isText && buffer.byteLength <= 512 * 1024) {
          blocks.push({
            type: "resource",
            resource: {
              uri,
              mimeType: file.mimeType,
              text: buffer.toString("utf8")
            }
          });
        } else {
          blocks.push({
            type: "resource",
            resource: {
              uri,
              mimeType: file.mimeType,
              blob: buffer.toString("base64")
            }
          });
        }
      } else {
        // Baseline ACP capability: resource_link with file URI.
        blocks.push({
          type: "resource_link",
          uri,
          name: file.fileName,
          mimeType: file.mimeType,
          size: file.sizeBytes,
          title: file.fileName
        });
      }
    }
    if (text) blocks.push({ type: "text", text });
    return blocks;
  }

  dispose(): void {
    this.abortController?.abort();
    if (this.activeAcpSessionId) clearSessionUpdateListeners(this.activeAcpSessionId);
    this.unsubscribeSessionUpdates?.();
    this.unsubscribeSessionUpdates = undefined;
    this.connection?.dispose();
    this.connection = undefined;
  }
}

let imStreamHandler: ((event: AcpStreamEvent) => Promise<void>) | null | undefined;

function emitToWindow(getMainWindow: GetMainWindow, event: AcpStreamEvent): void {
  const win = getMainWindow();
  if (win && !win.isDestroyed()) {
    win.webContents.send("acp:stream", event);
  }
  if (imStreamHandler === undefined) {
    imStreamHandler = null;
    void import("../im/ipc").then((mod) => {
      imStreamHandler = mod.handleImAcpStream;
      return mod.handleImAcpStream(event);
    }).catch(() => {
      imStreamHandler = null;
    });
    return;
  }
  if (imStreamHandler) void imStreamHandler(event);
}

function findControllerChatIdByAcpSessionId(sessionId: string | undefined): string | null {
  if (!sessionId) return null;
  for (const [chatId, controller] of controllers) {
    if (controller.getActiveAcpSessionId() === sessionId) return chatId;
  }
  return null;
}

function resolveChatIdForSession(sessionId: string | undefined): string | null {
  return (
    findControllerChatIdByAcpSessionId(sessionId) ||
    (lastActiveChatId && controllers.has(lastActiveChatId) ? lastActiveChatId : null) ||
    controllers.keys().next().value ||
    null
  );
}

let acpHostDeps: { loadSettings: LoadSettings; getMainWindow: GetMainWindow } | null = null;

export async function connectAcpChat(chatId: string, force = false): Promise<void> {
  if (!acpHostDeps) throw new Error("ACP host is not registered.");
  const { loadSettings, getMainWindow } = acpHostDeps;
  const settings = await loadSettings();
  const panelHome = effectivePanelHome(settings);
  const record = await getAcpRecord(panelHome, chatId);
  if (!record) throw new Error("ACP session not found.");

  let controller = controllers.get(chatId);
  if (controller && !force && controller.isLive()) {
    lastActiveChatId = chatId;
    controller.repostSnapshot();
    return;
  }
  if (controller) {
    controller.dispose();
    controllers.delete(chatId);
  }
  controller = new AcpChatController(record, panelHome, settings, (event) =>
    emitToWindow(getMainWindow, event)
  );
  controllers.set(chatId, controller);
  lastActiveChatId = chatId;
  await controller.bootstrap();
}

export async function promptAcpChat(
  chatId: string,
  text: string,
  images: IncomingAcpImage[] = [],
  files: IncomingAcpFile[] = []
): Promise<void> {
  const controller = controllers.get(chatId);
  if (!controller) throw new Error("ACP chat is not connected.");
  lastActiveChatId = chatId;
  await controller.sendMessage(text, images, files);
}

export async function denyAcpPermission(requestId: string): Promise<void> {
  const waiter = permissionWaiters.get(requestId);
  if (!waiter) return;
  permissionWaiters.delete(requestId);
  waiter.resolve({ outcome: { outcome: "cancelled" } });
}

export async function setAcpModel(chatId: string, modelId: string): Promise<void> {
  const controller = controllers.get(chatId);
  if (controller && modelId) {
    await controller.setModel(modelId);
  }
}

export function registerAcpIpc(deps: {
  loadSettings: LoadSettings;
  getMainWindow: GetMainWindow;
}): void {
  acpHostDeps = deps;
  const { loadSettings, getMainWindow } = deps;

  setPermissionPromptHandler(async (params: RequestPermissionRequest): Promise<RequestPermissionResponse> => {
    const settings = await loadSettings();
    if (autoApprovePermissions(settings)) {
      const allow = params.options.find((option) => option.kind === "allow_once" || option.kind === "allow_always");
      if (allow) {
        return { outcome: { outcome: "selected", optionId: allow.optionId } };
      }
    }

    const chatId = resolveChatIdForSession(params.sessionId);
    if (!chatId) {
      return { outcome: { outcome: "cancelled" } };
    }

    const requestId = crypto.randomUUID();
    const title = params.toolCall.title ?? "Agent permission";
    emitToWindow(getMainWindow, {
      type: "permissionRequest",
      chatId,
      requestId,
      title,
      options: params.options.map((option) => ({
        optionId: option.optionId,
        name: option.name,
        kind: option.kind
      }))
    });

    return await new Promise<RequestPermissionResponse>((resolve) => {
      const finish = (value: RequestPermissionResponse) => {
        permissionWaiters.delete(requestId);
        emitToWindow(getMainWindow, { type: "permissionResolved", chatId, requestId });
        resolve(value);
      };
      const timer = setTimeout(() => {
        finish({ outcome: { outcome: "cancelled" } });
      }, 120_000);
      permissionWaiters.set(requestId, {
        chatId,
        resolve: (value) => {
          clearTimeout(timer);
          finish(value);
        }
      });
    });
  });

  setAskUserQuestionHandler(async (params: AskUserQuestionRequest): Promise<AskUserQuestionResponse> => {
    const chatId = resolveChatIdForSession(params.sessionId);
    if (!chatId) {
      return makeCancelledQuestionResponse();
    }

    const requestId = crypto.randomUUID();
    emitToWindow(getMainWindow, {
      type: "userQuestion",
      chatId,
      requestId,
      questions: params.questions
    });

    return await new Promise<AskUserQuestionResponse>((resolve) => {
      const finish = (value: AskUserQuestionResponse) => {
        questionWaiters.delete(requestId);
        emitToWindow(getMainWindow, { type: "userQuestionResolved", chatId, requestId });
        resolve(value);
      };
      const timer = setTimeout(() => {
        finish(makeCancelledQuestionResponse());
      }, QUESTION_TIMEOUT_MS);
      questionWaiters.set(requestId, {
        chatId,
        resolve: (value) => {
          clearTimeout(timer);
          finish(value);
        }
      });
    });
  });

  // Grok (and similar) write session plan.md via fs/write_text_file — surface to UI.
  setPlanWriteListener(({ path: planPath, content }) => {
    const chatId = resolveChatIdForSession(undefined);
    if (!chatId) return;
    emitToWindow(getMainWindow, {
      type: "planFile",
      chatId,
      path: planPath,
      content,
      updatedAt: Date.now()
    });
  });

  safeHandle("acp:listSessions", async (_event, args?: { projectPath?: string }) => {
    const settings = await loadSettings();
    const panelHome = effectivePanelHome(settings);
    const records = await loadAcpRecords(panelHome);
    const projectPath = args?.projectPath?.trim();
    if (!projectPath) return records;
    return records.filter((record) => record.projectPath === projectPath);
  });

  safeHandle(
    "acp:createSession",
    async (_event, args: { projectPath: string; provider: AcpAgentProvider }) => {
      const settings = await loadSettings();
      const panelHome = effectivePanelHome(settings);
      const projectPath = args.projectPath?.trim();
      const provider = args.provider;
      if (!projectPath) throw new Error("Working directory is required.");
      if (!["codex", "claude", "grok", "opencode", "pi", "prime"].includes(provider)) {
        throw new Error(`Unsupported ACP provider: ${provider}`);
      }
      return createAcpRecord(panelHome, projectPath, provider);
    }
  );

  safeHandle("acp:getSession", async (_event, args: { chatId: string }) => {
    const settings = await loadSettings();
    const panelHome = effectivePanelHome(settings);
    return (await getAcpRecord(panelHome, args.chatId)) ?? null;
  });

  safeHandle("acp:deleteSession", async (_event, args: { chatId: string }) => {
    disposeAcpController(args.chatId);
    const settings = await loadSettings();
    await deleteAcpRecord(effectivePanelHome(settings), args.chatId);
    return { ok: true };
  });

  safeHandle("acp:renameSession", async (_event, args: { chatId: string; title: string }) => {
    const controller = controllers.get(args.chatId);
    if (controller) return controller.rename(args.title);
    const settings = await loadSettings();
    const panelHome = effectivePanelHome(settings);
    const record = await getAcpRecord(panelHome, args.chatId);
    if (!record) throw new Error("ACP session not found.");
    record.title = args.title.trim() || record.title;
    record.updatedAt = Date.now();
    await updateAcpRecord(panelHome, record);
    return record;
  });

  safeHandle("acp:loadMessages", async (_event, args: { chatId: string }) => {
    const settings = await loadSettings();
    return loadAcpMessages(effectivePanelHome(settings), args.chatId);
  });

  safeHandle("acp:connect", async (_event, args: { chatId: string; force?: boolean }) => {
    const existed = controllers.get(args.chatId);
    const reused = Boolean(existed && !args.force && existed.isLive());
    await connectAcpChat(args.chatId, args.force === true);
    const controller = controllers.get(args.chatId);
    if (!controller) throw new Error("ACP session not found.");
    return { ok: true, record: controller.getRecord(), reused };
  });

  safeHandle(
    "acp:prompt",
    async (
      _event,
      args: { chatId: string; text?: string; images?: IncomingAcpImage[]; files?: IncomingAcpFile[] }
    ) => {
      await promptAcpChat(args.chatId, args.text ?? "", args.images ?? [], args.files ?? []);
      return { ok: true };
    }
  );

  safeHandle("acp:cancel", async (_event, args: { chatId: string }) => {
    const controller = controllers.get(args.chatId);
    if (controller) await controller.cancel();
    return { ok: true };
  });

  safeHandle("acp:setMode", async (_event, args: { chatId: string; modeId: string }) => {
    const controller = controllers.get(args.chatId);
    if (controller) await controller.setMode(args.modeId);
    return { ok: true };
  });

  safeHandle(
    "acp:setConfigOption",
    async (_event, args: { chatId: string; configId: string; value: string | boolean }) => {
      const controller = controllers.get(args.chatId);
      if (controller) await controller.setConfigOption(args.configId, args.value);
      return { ok: true };
    }
  );

  safeHandle(
    "acp:respondPermission",
    async (_event, args: { requestId: string; optionId?: string; cancelled?: boolean }) => {
      const waiter = permissionWaiters.get(args.requestId);
      if (!waiter) return { ok: false };
      permissionWaiters.delete(args.requestId);
      if (args.cancelled || !args.optionId) {
        waiter.resolve({ outcome: { outcome: "cancelled" } });
      } else {
        waiter.resolve({ outcome: { outcome: "selected", optionId: args.optionId } });
      }
      return { ok: true };
    }
  );

  safeHandle(
    "acp:respondQuestion",
    async (
      _event,
      args: {
        requestId: string;
        cancelled?: boolean;
        /** question text → chosen option label(s), multi-select joined with ", " */
        answers?: Record<string, string>;
      }
    ) => {
      const waiter = questionWaiters.get(args.requestId);
      if (!waiter) return { ok: false };
      questionWaiters.delete(args.requestId);
      if (args.cancelled) {
        waiter.resolve(makeCancelledQuestionResponse());
        return { ok: true };
      }
      const answers: Record<string, string> = {};
      if (args.answers && typeof args.answers === "object") {
        for (const [question, label] of Object.entries(args.answers)) {
          if (typeof question === "string" && typeof label === "string" && question && label.trim()) {
            answers[question] = label.trim();
          }
        }
      }
      if (!Object.keys(answers).length) {
        waiter.resolve(makeCancelledQuestionResponse());
      } else {
        waiter.resolve(makeAcceptedQuestionResponse(answers));
      }
      return { ok: true };
    }
  );

  safeHandle("acp:readPlanFile", async (_event, args: { path: string }) => {
    return readPlanFile(args.path);
  });

  safeHandle("acp:openPath", async (_event, args: { path: string }) => {
    const target = typeof args.path === "string" ? args.path.trim() : "";
    if (!target) throw new Error("Path is required.");
    const error = await shell.openPath(target);
    if (error) throw new Error(error);
    return { ok: true };
  });

  safeHandle("acp:disconnect", async (_event, args: { chatId: string }) => {
    const controller = controllers.get(args.chatId);
    controller?.dispose();
    controllers.delete(args.chatId);
    return { ok: true };
  });
}

/** Persist a catalog project move onto a live ACP chat so later controller writes keep the new path. */
export async function setAcpRecordProjectPath(
  chatId: string,
  projectPath: string
): Promise<boolean> {
  const id = chatId.trim();
  const next = projectPath.trim();
  if (!id || !next) return false;
  const controller = controllers.get(id);
  if (!controller) return false;
  await controller.setProjectPath(next);
  return true;
}

/** Dispose a live ACP controller for a chat id (e.g. before store delete on remove). */
export function disposeAcpController(chatId: string): void {
  const id = chatId.trim();
  if (!id) return;
  const controller = controllers.get(id);
  if (!controller) return;
  controller.dispose();
  controllers.delete(id);
  if (lastActiveChatId === id) {
    lastActiveChatId = null;
  }
}

export function getAcpRuntimeMetrics(): { count: number; liveCount: number } {
  let liveCount = 0;
  for (const controller of controllers.values()) {
    if (controller.isLive()) liveCount += 1;
  }
  return { count: controllers.size, liveCount };
}

export function disposeAllAcpControllers(): void {
  for (const controller of controllers.values()) {
    controller.dispose();
  }
  controllers.clear();
  permissionWaiters.clear();
  questionWaiters.clear();
  setPermissionPromptHandler(null);
  setAskUserQuestionHandler(null);
  setPlanWriteListener(null);
}

function extractTextFromContent(content: unknown): string {
  if (!content || typeof content !== "object") return "";
  const block = content as { type?: string; text?: string };
  if (block.type === "text" && typeof block.text === "string") return block.text;
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
      if (result[index]!.role !== "assistant") continue;
      const assistant = result[index]!;
      const toolCalls = [...(assistant.toolCalls ?? [])];
      const existingIndex = toolCalls.findIndex((entry) => entry.toolCallId === info.toolCallId);
      if (existingIndex >= 0) toolCalls[existingIndex] = mergeToolCallInfo(toolCalls[existingIndex]!, info);
      else toolCalls.push(info);
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
  const title = match ? match[1]!.trim() : firstLine;
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

function parseAvailableCommands(value: unknown): AcpAvailableCommand[] {
  if (!Array.isArray(value)) return [];
  const commands: AcpAvailableCommand[] = [];
  const names = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const raw = item as { name?: unknown; description?: unknown; input?: { hint?: unknown } | null };
    const name = typeof raw.name === "string" ? raw.name.trim().replace(/^\/+/, "") : "";
    if (!name || /[\s/]/.test(name)) continue;
    const normalizedName = name.toLocaleLowerCase();
    if (names.has(normalizedName)) continue;
    names.add(normalizedName);
    const description = typeof raw.description === "string" ? raw.description.trim() : "";
    const inputHint = typeof raw.input?.hint === "string" ? raw.input.hint.trim() : "";
    commands.push({ name, description, ...(inputHint ? { inputHint } : {}) });
  }
  return commands;
}

function parseLocations(value: unknown): AcpToolCallLocation[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const locations: AcpToolCallLocation[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const location = item as { path?: string; line?: number };
    if (typeof location.path !== "string") continue;
    const entry: AcpToolCallLocation = { path: location.path };
    if (typeof location.line === "number") entry.line = location.line;
    locations.push(entry);
  }
  return locations.length ? locations : undefined;
}

function parseToolCallFromUpdate(
  update: Record<string, unknown>,
  defaultStatus?: AcpToolCallStatus
): AcpToolCallInfo {
  const toolCallId = typeof update.toolCallId === "string" ? update.toolCallId : crypto.randomUUID();
  const title = typeof update.title === "string" && update.title.trim() ? update.title : undefined;
  const kind = typeof update.kind === "string" && update.kind.trim() ? update.kind : undefined;
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
    title: incoming.title ?? existing.title,
    kind: incoming.kind ?? existing.kind,
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
      if (!entry || typeof entry !== "object") return "";
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
  return formatAcpError(error);
}
