import type { BrowserWindow } from "electron";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  desktopDbPath,
  discoverSkills,
  effectivePanelHome,
  expandHome,
  formatSkillsCatalogPrompt,
  loadSettings,
  type PanelSettings
} from "@agent-resume/core";
import { createAcpRecord, getAcpRecord } from "../acp/store";
import type { AcpAgentProvider, AcpStreamEvent, AcpToolCallInfo } from "../acp/types";
import { routeMessageIntent } from "./intentRouter";
import { buildDispatchPrompt, buildIncrementalPrompt, extractFirstQuestionTitle, isDefaultChatName, saveImMessageImage, type ImStore } from "./store";
import {
  DEFAULT_BUILTIN_CALLABLE_TEMPLATE_IDS,
  isBuiltinTemplateId,
  isImAgent,
  type ImDelegationProposal,
  type ImDispatchBlock,
  type ImEvent,
  type ImImageAttachment,
  type ImJob,
  type ImJobBrief,
  type ImJobStatus,
  type ImKnowledgeSnapshot,
  type ImMember,
  type ImMessage,
  type ImQuotedMessage,
  type ImRoleTools
} from "./types";

type ConnectFn = (chatId: string) => Promise<{ rebuilt?: boolean } | void>;
type PromptFn = (
  chatId: string,
  text: string,
  images?: Array<{ mimeType: string; fileName: string; data: string }>
) => Promise<void>;
type DenyPermissionFn = (requestId: string) => Promise<void>;
type SetModelFn = (chatId: string, modelId: string) => Promise<void>;
type SetThoughtLevelFn = (chatId: string, thoughtLevel: string) => Promise<void>;
type CancelChatFn = (chatId: string) => Promise<void>;
type InspectChatFn = (chatId: string) => { live: boolean; running: boolean };

const WRITER_BUSY: ReadonlySet<ImJobStatus> = new Set([
  "queued",
  "connecting",
  "running",
  "awaiting_user"
]);

function isMutatingToolCall(call: AcpToolCallInfo): boolean {
  const kind = call.kind?.toLowerCase();
  if (kind === "edit" || kind === "write" || kind === "delete" || kind === "move" || kind === "create") {
    return true;
  }
  if (kind === "read" || kind === "search" || kind === "think" || kind === "fetch") {
    return false;
  }
  const title = (call.title || "").toLowerCase();
  if (/edit|write|delete|move|create|update|patch|remove/i.test(title)) {
    return true;
  }
  if (call.rawInput && typeof call.rawInput === "object" && !Array.isArray(call.rawInput)) {
    const input = call.rawInput as Record<string, unknown>;
    if ("old_string" in input || "new_string" in input || "target_file" in input || "target_directory" in input) {
      return true;
    }
  }
  return false;
}

function extractPathsFromToolCall(call: AcpToolCallInfo): string[] {
  const paths: string[] = [];
  if (call.locations?.length) {
    for (const loc of call.locations) {
      if (loc.path?.trim()) paths.push(loc.path.trim());
    }
  }
  if (call.rawInput && typeof call.rawInput === "object" && !Array.isArray(call.rawInput)) {
    const input = call.rawInput as Record<string, unknown>;
    for (const key of ["file_path", "filePath", "path", "target_file", "file"]) {
      const val = input[key];
      if (typeof val === "string" && val.trim()) {
        paths.push(val.trim());
      }
    }
  }
  return paths;
}

export const HANDOFF_QUOTE_BODY_MAX = 4000;

export function stripDispatchBlocks(text: string): string {
  if (!text) return "";
  return text
    .replace(/<im_dispatch\s+target="([^"]+)"(?:\s+reason="([^"]*)")?>([\s\S]*?)<\/im_dispatch>/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function toHandoffQuote(message?: ImMessage | null): ImQuotedMessage | undefined {
  if (!message || message.kind !== "role.say") return undefined;
  const cleanedBody = stripDispatchBlocks(message.body);
  if (!cleanedBody.trim()) return undefined;

  let body = cleanedBody.trim();
  let truncated = false;
  if (body.length > HANDOFF_QUOTE_BODY_MAX) {
    body = `${body.slice(0, HANDOFF_QUOTE_BODY_MAX - 1)}…`;
    truncated = true;
  }

  return {
    messageId: message.messageId,
    authorLabel: message.authorLabel || "Role",
    body,
    createdAtMs: message.createdAtMs || Date.now(),
    truncated
  };
}

export function mergeHandoffQuotes(
  handoffQuote: ImQuotedMessage | undefined,
  existingQuotes: ImQuotedMessage[] = []
): ImQuotedMessage[] {
  if (!handoffQuote) return [...existingQuotes];
  const filtered = existingQuotes.filter((q) => q.messageId !== handoffQuote.messageId);
  return [handoffQuote, ...filtered];
}

export function parseDispatchBlocks(text: string): ImDispatchBlock[] {
  const regex = /<im_dispatch\s+target="([^"]+)"(?:\s+reason="([^"]*)")?>([\s\S]*?)<\/im_dispatch>/gi;
  const blocks: ImDispatchBlock[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const target = match[1]?.trim() || "";
    const reason = match[2]?.trim() || undefined;
    const instruction = match[3]?.trim() || "";
    if (target && instruction) {
      blocks.push({ target, reason, instruction });
    }
  }
  return blocks;
}

export function resolveDispatchTarget(
  target: string,
  allowedCalleeIds: string[],
  enabledMembers: ImMember[]
): ImMember | undefined {
  const trimmed = target.trim();
  const lower = trimmed.toLowerCase();

  // Level 1: exact templateId / memberId match
  let found = enabledMembers.find((m) => m.templateId === trimmed || m.memberId === trimmed);

  // Level 2: case-insensitive name match, templateId match, or alias
  if (!found) {
    found = enabledMembers.find((m) =>
      m.name.toLowerCase() === lower ||
      m.templateId.toLowerCase() === lower ||
      m.templateId.replace(/^role_/, "").toLowerCase() === lower ||
      m.templateId.replace(/^project_role_/, "").toLowerCase() === lower ||
      (lower === "developer" && m.templateId === "role_developer") ||
      (lower === "architect" && m.templateId === "role_architect") ||
      (lower === "pm" && m.templateId === "role_product_manager") ||
      (lower === "tester" && m.templateId === "role_tester") ||
      (lower === "qa" && m.templateId === "role_tester") ||
      (lower === "ui" && m.templateId === "role_ui_designer") ||
      (lower === "memory" && m.templateId === "role_memory") ||
      (lower === "archivist" && m.templateId === "role_memory")
    );
  }

  // Security check: Must be in allowedCalleeIds
  if (found && allowedCalleeIds.includes(found.templateId)) {
    return found;
  }
  return undefined;
}

function buildResumeInstruction(original: string, draft?: ImMessage): string {
  const instruction = original.trim();
  const saved = [draft?.thinking, draft?.body].filter((part) => part?.trim()).join("\n\n").trim();
  if (!saved) return instruction;
  return [
    instruction,
    "",
    "[Interrupted previous attempt]",
    "Your previous reply was cut off by an app restart. Continue from this saved draft. Do not repeat completed sections. Finish the remaining work.",
    saved
  ].join("\n");
}

export function collectFiles(toolCalls: AcpToolCallInfo[] | undefined, current: string[]): string[] {
  if (!toolCalls?.length) return current;
  const next = new Set(current);
  for (const call of toolCalls) {
    if (!isMutatingToolCall(call)) continue;
    const paths = extractPathsFromToolCall(call);
    for (const p of paths) {
      next.add(p);
    }
  }
  return [...next];
}

const STREAM_PERSIST_MS = 500;

/**
 * Session model: one ImMember keeps one ACP chat (`acpChatId`).
 * Quote, @, continue-ask, and resume all reuse that chat. A new ACP record is
 * created only when the agent changes, cwd no longer matches, the record is
 * missing, or session restore falls through to session/new.
 * Prompt mode is separate: bootstrap sends the full brief; incremental sends
 * only this turn so prefix KV cache can hit on a live session.
 */

export class ImConductor {
  private readonly jobsByChat = new Map<string, string>();
  private readonly pendingByChat = new Map<string, { resolve: () => void; reject: (error: Error) => void }>();
  private readonly streamingMessagesByJob = new Map<string, ImMessage>();
  private readonly streamingPersistAt = new Map<string, number>();
  private readonly streamingPersistChain = new Map<string, Promise<void>>();
  private readonly persistedStreamingIds = new Set<string>();

  constructor(
    private readonly store: ImStore,
    private readonly emit: (event: ImEvent) => void,
    private readonly connectChat: ConnectFn,
    private readonly promptChat: PromptFn,
    private readonly denyPermission?: DenyPermissionFn,
    private readonly setModel?: SetModelFn,
    private readonly setThoughtLevel?: SetThoughtLevelFn,
    private readonly cancelChat?: CancelChatFn,
    private readonly inspectChat?: InspectChatFn
  ) {}

  async postMessage(input: {
    projectId: string;
    body: string;
    quoteIds: string[];
    mentionRoleIds: string[];
    images?: Array<{ fileName: string; mimeType: string; data: string }>;
    followUpToMessageId?: string;
  }): Promise<{ message: Awaited<ReturnType<ImStore["insertMessage"]>>; job: ImJob | null }> {
    const room = await this.store.getRoom(input.projectId);
    const body = this.store.clipInstruction(input.body);
    const hasImages = Boolean(input.images?.length);
    if (!body.trim() && !input.quoteIds.length && !hasImages) {
      throw new Error("Message is empty.");
    }
    let mentionIds = [...new Set(input.mentionRoleIds.filter(Boolean))];
    let followUp: ImMessage | undefined;
    let threadId: string | undefined;
    if (input.followUpToMessageId) {
      followUp = await this.store.getMessage(input.followUpToMessageId);
      if (!followUp || followUp.projectId !== input.projectId || followUp.kind !== "role.say") {
        throw new Error("Follow-up target is not an agent reply in this room.");
      }
      if (!followUp.authorMemberId) throw new Error("Follow-up target has no role.");
      const authorMemberId = followUp.authorMemberId;
      const followMember = room.members.find((item) => item.memberId === authorMemberId && item.enabled);
      if (!followMember) throw new Error("Target role is not enabled in this room.");
      const busy = room.jobs.some((job) => job.memberId === followMember.memberId && WRITER_BUSY.has(job.status));
      if (busy) throw new Error("That role is already working.");
      mentionIds = [followMember.memberId];
      threadId = followUp.threadId || followUp.jobId || followUp.messageId;
    }
    const quotes = await this.store.resolveQuotes(input.projectId, input.quoteIds);
    const settings = await loadSettings();
    const panelHome = effectivePanelHome(settings);
    const enabledMembers = room.members.filter((m) => m.enabled);
    const isSingleRoleDirect = !mentionIds.length && enabledMembers.length === 1;
    const cwd = (mentionIds.length || isSingleRoleDirect)
      ? await this.store.ensureProjectLocalPath(input.projectId, panelHome)
      : room.project.localPath;
    const savedImages: ImImageAttachment[] = [];
    if (input.images?.length) {
      for (const img of input.images) {
        const saved = await saveImMessageImage(panelHome, input.projectId, img);
        savedImages.push(saved);
      }
    }

    if (!threadId && (mentionIds.length || isSingleRoleDirect)) threadId = crypto.randomUUID();
    const message = await this.store.insertMessage({
      projectId: input.projectId,
      kind: "human",
      authorLabel: "You",
      body: body.trim() || (savedImages.length ? "(attached images)" : "(quoted messages)"),
      images: savedImages.length ? savedImages : undefined,
      quoteIds: quotes.map((quote) => quote.messageId),
      mentionRoleIds: mentionIds,
      threadId
    });
    this.emit({ type: "message", projectId: input.projectId, message });

    // Auto-fill chat name from the first user question if still using a default name
    if (isDefaultChatName(room.project.name) && body.trim()) {
      const suggested = extractFirstQuestionTitle(body);
      if (suggested) {
        try {
          await this.store.renameProject(input.projectId, suggested);
          const updatedRoom = await this.store.getRoom(input.projectId);
          this.emit({ type: "room", room: updatedRoom });
        } catch {
          // best-effort
        }
      }
    }

    const targetMembers: ImMember[] = mentionIds.length
      ? mentionIds.map((mentionId) => {
          const member = room.members.find((item) => item.memberId === mentionId && item.enabled);
          if (!member) throw new Error("Mentioned role is not in this room.");
          return member;
        })
      : (isSingleRoleDirect ? [enabledMembers[0]!] : []);

    if (!targetMembers.length) {
      if (body.trim() && settings.im?.smartRoutingEnabled !== false) {
        if (enabledMembers.length > 0) {
          void this.performAsyncIntentRouting({
            projectId: input.projectId,
            message,
            text: body.trim(),
            enabledMembers,
            quotes,
            knowledge: this.store.snapshotKnowledge(room.knowledge),
            savedImages,
            settings,
            panelHome
          });
        }
      }
      return { message, job: null };
    }

    const knowledge = this.store.snapshotKnowledge(room.knowledge);
    const jobs: ImJob[] = [];
    let exclusiveBusy = Boolean(await this.store.findActiveWriterJob(input.projectId));
    for (const member of targetMembers) {
      const template = await this.store.getTemplate(member.templateId);
      const agent = template?.agent ?? member.agent;
      const persona = template?.persona ?? member.persona;
      if (!isImAgent(agent)) {
        throw new Error("IM only supports Pi, Claude Code, and Codex.");
      }
      const exclusive = this.store.memberNeedsExclusiveLock(member);
      const startNow = !exclusive || !exclusiveBusy;
      if (exclusive && startNow) exclusiveBusy = true;
      const job = await this.store.createJob({
        projectId: input.projectId,
        memberId: member.memberId,
        messageId: message.messageId,
        brief: {
          persona,
          instruction: body.trim(),
          cwd: cwd!,
          quotes: followUp ? [] : quotes,
          knowledge,
          images: savedImages.length ? savedImages : undefined
        },
        status: "queued",
        threadId
      });
      if (jobs.length === 0) await this.store.attachJobToMessage(message.messageId, job.jobId);
      this.emit({ type: "job", projectId: input.projectId, job });
      jobs.push(job);
      if (startNow) this.launchJob(job.jobId, member);
    }
    return { message, job: jobs[0] ?? null };
  }

  private launchJob(jobId: string, member: ImMember): void {
    void this.runJob(jobId).catch(async (error) => {
      try {
        await this.flushStreamingMessage(jobId);
        this.forgetStreamingMessage(jobId);
        const failed = await this.store.updateJob(jobId, {
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
          finished: true
        });
        this.emit({ type: "job", projectId: failed.projectId, job: failed });
        const card = await this.store.insertMessage({
          projectId: failed.projectId,
          kind: "job.card",
          authorMemberId: failed.memberId,
          authorLabel: member.name,
          body: failed.error || "Job failed.",
          jobId: failed.jobId
        });
        this.emit({ type: "message", projectId: failed.projectId, message: card });
        await this.pumpExclusiveQueue(failed.projectId);
      } catch {
        // Store may already be gone (tests / shutdown).
      }
    });
  }

  async cancelJob(jobId: string): Promise<ImJob> {
    const streamMsg = this.streamingMessagesByJob.get(jobId);
    if (streamMsg?.body || streamMsg?.thinking) {
      const persisted = await this.persistStreamingMessage(jobId);
      this.emit({
        type: "messageUpdate",
        projectId: persisted.projectId,
        message: { ...persisted, streaming: false }
      });
    }
    this.forgetStreamingMessage(jobId);
    const cancelled = await this.store.cancelJob(jobId);
    this.emit({ type: "job", projectId: cancelled.projectId, job: cancelled });
    const chatId = cancelled.acpChatId;
    if (chatId) {
      this.jobsByChat.delete(chatId);
      this.settlePrompt(chatId, new Error("Job cancelled by user"));
      if (this.cancelChat) {
        try {
          await this.cancelChat(chatId);
        } catch (err) {
          console.warn(`[IM Conductor] Failed to cancel ACP chat ${chatId}:`, err);
        }
      }
    }
    try {
      await this.pumpExclusiveQueue(cancelled.projectId);
    } catch {
      // ignore
    }
    return cancelled;
  }

  async handleAcpStream(event: AcpStreamEvent): Promise<void> {
    const chatId = event.chatId;
    let jobId = this.jobsByChat.get(chatId) ?? (await this.store.findJobByAcpChatId(chatId))?.jobId;
    if (!jobId) {
      const interrupted = await this.store.findInterruptedJobByAcpChatId(chatId);
      if (!interrupted) return;
      const revived = await this.store.updateJob(interrupted.jobId, {
        status: event.type === "status" && (event.isConnecting || event.status === "connecting") ? "connecting" : "running",
        error: null,
        finished: false
      });
      this.jobsByChat.set(chatId, revived.jobId);
      this.emit({ type: "job", projectId: revived.projectId, job: revived });
      jobId = revived.jobId;
    }
    const current = await this.store.getJob(jobId);
    if (!current || !WRITER_BUSY.has(current.status)) return;

    if (event.type === "status") {
      let status: ImJobStatus = current.status;
      if (event.status === "error") status = "failed";
      else if (event.isConnecting || event.status === "connecting") status = "connecting";
      else if (event.isRunning || event.status === "running" || event.status === "thinking") status = "running";
      if (status !== current.status) {
        const job = await this.store.updateJob(jobId, {
          status,
          error: status === "failed" ? event.status : current.error,
          finished: status === "failed"
        });
        this.emit({ type: "job", projectId: job.projectId, job });
        if (status === "failed") this.settlePrompt(chatId, new Error(event.status || "ACP error"));
      }
      return;
    }

    if (event.type === "error") {
      const job = await this.store.updateJob(jobId, {
        status: "failed",
        error: event.message,
        finished: true
      });
      this.emit({ type: "job", projectId: job.projectId, job });
      this.settlePrompt(chatId, new Error(event.message));
      return;
    }

    if (event.type === "permissionRequest") {
      const member = await this.store.getMember(current.memberId);
      const template = member ? await this.store.getTemplate(member.templateId) : undefined;
      const tools = template?.tools ?? member?.tools;
      const blob = `${event.title} ${event.options.map((option) => `${option.kind} ${option.name}`).join(" ")}`;
      const capability: keyof ImRoleTools | null = /edit|write|delete|move|create/i.test(blob)
        ? "fsWrite"
        : /exec|command|terminal|bash|shell/i.test(blob)
          ? "execute"
          : null;
      if (capability && tools && tools[capability] === false) {
        await this.denyPermission?.(event.requestId);
        const denied = await this.store.updateJob(jobId, {
          status: "running",
          permission: null
        });
        this.emit({ type: "job", projectId: denied.projectId, job: denied });
        const card = await this.store.insertMessage({
          projectId: denied.projectId,
          kind: "system",
          authorLabel: "IM",
          body: `Blocked ${capability} for this role: ${event.title}`,
          jobId
        });
        this.emit({ type: "message", projectId: denied.projectId, message: card });
        return;
      }
      const job = await this.store.updateJob(jobId, {
        status: "awaiting_user",
        permission: {
          requestId: event.requestId,
          title: event.title,
          options: event.options
        }
      });
      this.emit({ type: "job", projectId: job.projectId, job });
      return;
    }

    if (event.type === "permissionResolved") {
      const job = await this.store.updateJob(jobId, {
        status: current.status === "awaiting_user" ? "running" : current.status,
        permission: null
      });
      this.emit({ type: "job", projectId: job.projectId, job });
      return;
    }

    if (event.type === "assistantDelta") {
      const filesChanged = collectFiles(event.toolCalls, current.filesChanged);
      const filesCountChanged = filesChanged.length !== current.filesChanged.length;
      if (filesCountChanged || current.status !== "running") {
        const job = await this.store.updateJob(jobId, {
          status: "running",
          filesChanged
        });
        this.emit({ type: "job", projectId: job.projectId, job });
      }

      const text = event.text || "";
      const thinking = event.thinking || "";
      if (text || thinking) {
        let streamMsg = this.streamingMessagesByJob.get(jobId);
        if (!streamMsg) {
          const existingMessage = await this.store.findMessageByJobId(jobId, "role.say");
          if (existingMessage) {
            streamMsg = {
              ...existingMessage,
              body: text,
              thinking: thinking || existingMessage.thinking,
              streaming: true
            };
            this.streamingMessagesByJob.set(jobId, streamMsg);
            this.persistedStreamingIds.add(existingMessage.messageId);
            this.emit({ type: "messageUpdate", projectId: current.projectId, message: streamMsg });
          } else {
            const member = await this.store.getMember(current.memberId);
            streamMsg = {
              messageId: crypto.randomUUID(),
              projectId: current.projectId,
              kind: "role.say",
              authorMemberId: current.memberId,
              authorLabel: member?.name || "Role",
              body: text,
              thinking: thinking || undefined,
              streaming: true,
              quoteIds: [],
              quotes: [],
              mentionRoleIds: [],
              jobId,
              threadId: current.threadId,
              createdAtMs: Date.now()
            };
            this.streamingMessagesByJob.set(jobId, streamMsg);
            this.emit({ type: "message", projectId: current.projectId, message: streamMsg });
          }
        } else {
          streamMsg = {
            ...streamMsg,
            body: text,
            thinking: thinking || undefined,
            streaming: true
          };
          this.streamingMessagesByJob.set(jobId, streamMsg);
          this.emit({ type: "messageUpdate", projectId: current.projectId, message: streamMsg });
        }
        if (!this.persistedStreamingIds.has(streamMsg.messageId)) {
          await this.flushStreamingMessage(jobId);
        } else {
          this.scheduleStreamingPersist(jobId);
        }
      }
      return;
    }

    if (event.type === "assistantDone") {
      const filesChanged = collectFiles(event.message.toolCalls, current.filesChanged);
      const job = await this.store.updateJob(jobId, { filesChanged, status: "running" });
      this.emit({ type: "job", projectId: job.projectId, job });

      const streamMsg = this.streamingMessagesByJob.get(jobId);
      const finalBody = event.message.text.trim();
      const finalThinking = event.message.thinking?.trim();
      const proposals = await this.buildProposalsForJob(job, finalBody);

      let persistedMessage: ImMessage | null = null;
      if (streamMsg) {
        if (finalBody || finalThinking) {
          persistedMessage = await this.persistStreamingMessage(jobId, {
            body: finalBody,
            thinking: finalThinking,
            delegationProposals: proposals.length ? proposals : undefined
          });
          this.emit({
            type: "messageUpdate",
            projectId: job.projectId,
            message: { ...persistedMessage, streaming: false }
          });
        }
      } else if (finalBody || finalThinking) {
        const existingMessage = await this.store.findMessageByJobId(jobId, "role.say");
        if (existingMessage) {
          persistedMessage = await this.store.updateMessage(existingMessage.messageId, {
            body: finalBody,
            thinking: finalThinking,
            delegationProposals: proposals.length ? proposals : undefined
          });
          this.emit({
            type: "messageUpdate",
            projectId: job.projectId,
            message: { ...persistedMessage, streaming: false }
          });
        } else {
          const member = await this.store.getMember(job.memberId);
          persistedMessage = await this.store.insertMessage({
            projectId: job.projectId,
            kind: "role.say",
            authorMemberId: job.memberId,
            authorLabel: member?.name || "Role",
            body: finalBody,
            thinking: finalThinking,
            delegationProposals: proposals.length ? proposals : undefined,
            jobId,
            threadId: job.threadId
          });
          this.emit({ type: "message", projectId: job.projectId, message: { ...persistedMessage, streaming: false } });
        }
      }

      if (proposals.length > 0 && persistedMessage) {
        await this.executeAutoDispatches(job, persistedMessage, proposals);
      }
    }
  }

  private async buildProposalsForJob(job: ImJob, body: string): Promise<ImDelegationProposal[]> {
    const blocks = parseDispatchBlocks(body);
    if (!blocks.length) return [];
    const member = await this.store.getMember(job.memberId);
    if (!member) return [];
    const room = await this.store.getRoom(job.projectId);
    const allowedCalleeIds = member.callableTemplateIds ?? (
      isBuiltinTemplateId(member.templateId) ? [...DEFAULT_BUILTIN_CALLABLE_TEMPLATE_IDS[member.templateId]] : []
    );
    const enabledMembers = room.members.filter((m) => m.enabled && m.memberId !== member.memberId);
    const chain = job.brief.dispatchChain ?? [member.templateId];
    const MAX_CHAIN_DEPTH = 5;

    const proposals: ImDelegationProposal[] = [];
    for (const block of blocks) {
      const targetMember = resolveDispatchTarget(block.target, allowedCalleeIds, enabledMembers);
      const isLoop = targetMember ? chain.includes(targetMember.templateId) : false;
      const isTooDeep = chain.length >= MAX_CHAIN_DEPTH;
      const willAutoDispatch = Boolean(member.autoDispatch && targetMember && !isLoop && !isTooDeep);

      proposals.push({
        id: crypto.randomUUID(),
        targetTemplateId: targetMember?.templateId ?? block.target,
        targetRoleName: targetMember?.name ?? block.target,
        instruction: block.instruction,
        reason: block.reason,
        status: willAutoDispatch ? "auto_dispatched" : "pending",
        createdAtMs: Date.now()
      });
    }
    return proposals;
  }

  private async executeAutoDispatches(
    job: ImJob,
    sourceMessage: ImMessage,
    proposals: ImDelegationProposal[]
  ): Promise<void> {
    const member = await this.store.getMember(job.memberId);
    if (!member || !member.autoDispatch) return;
    const room = await this.store.getRoom(job.projectId);
    const chain = job.brief.dispatchChain ?? [member.templateId];
    const MAX_CHAIN_DEPTH = 5;
    const handoffQuote = toHandoffQuote(sourceMessage);
    const quotes = mergeHandoffQuotes(handoffQuote, job.brief.quotes);

    for (const proposal of proposals) {
      if (proposal.status !== "auto_dispatched") continue;
      const targetMember = room.members.find((m) => m.templateId === proposal.targetTemplateId && m.enabled);
      if (!targetMember) continue;
      const isLoop = chain.includes(targetMember.templateId);
      const isTooDeep = chain.length >= MAX_CHAIN_DEPTH;
      if (isLoop || isTooDeep) continue;

      const targetTemplate = await this.store.getTemplate(targetMember.templateId);
      const targetPersona = targetTemplate?.persona ?? targetMember.persona;
      const settings = await loadSettings();
      const panelHome = effectivePanelHome(settings);
      const cwd = await this.store.ensureProjectLocalPath(job.projectId, panelHome);
      const targetBrief: ImJobBrief = {
        persona: targetPersona,
        instruction: proposal.instruction,
        cwd,
        quotes,
        knowledge: job.brief.knowledge,
        dispatchChain: [...chain, targetMember.templateId]
      };
      const nextJob = await this.store.createJob({
        projectId: job.projectId,
        memberId: targetMember.memberId,
        messageId: null,
        brief: targetBrief,
        status: "queued",
        threadId: job.threadId
      });
      proposal.dispatchedJobId = nextJob.jobId;
      proposal.resolvedAtMs = Date.now();
      await this.store.updateMessageProposal(sourceMessage.messageId, proposal.id, {
        dispatchedJobId: nextJob.jobId,
        resolvedAtMs: proposal.resolvedAtMs
      });
      this.emit({ type: "job", projectId: job.projectId, job: nextJob });
      const exclusive = this.store.memberNeedsExclusiveLock(targetMember);
      const exclusiveBusy = Boolean(await this.store.findActiveWriterJob(job.projectId));
      const startNow = !exclusive || !exclusiveBusy;
      if (startNow) {
        this.launchJob(nextJob.jobId, targetMember);
      }
    }
  }

  async dispatchProposal(input: {
    projectId: string;
    messageId: string;
    proposalId: string;
  }): Promise<{ message: ImMessage; job: ImJob }> {
    const message = await this.store.getMessage(input.messageId);
    if (!message) throw new Error("Message not found.");
    const proposal = message.delegationProposals?.find((p) => p.id === input.proposalId);
    if (!proposal) throw new Error("Proposal not found.");
    if (proposal.status === "dispatched" || proposal.status === "auto_dispatched") {
      throw new Error("Proposal has already been dispatched.");
    }

    const room = await this.store.getRoom(input.projectId);
    const targetMember = room.members.find((m) => m.templateId === proposal.targetTemplateId && m.enabled);
    if (!targetMember) throw new Error("Target role is not enabled in this room.");

    const targetTemplate = await this.store.getTemplate(targetMember.templateId);
    const targetPersona = targetTemplate?.persona ?? targetMember.persona;
    const settings = await loadSettings();
    const panelHome = effectivePanelHome(settings);
    const cwd = await this.store.ensureProjectLocalPath(input.projectId, panelHome);

    const handoffQuote = toHandoffQuote(message);
    const quotes = mergeHandoffQuotes(handoffQuote, message.quotes);

    const targetBrief: ImJobBrief = {
      persona: targetPersona,
      instruction: proposal.instruction,
      cwd,
      quotes,
      knowledge: this.store.snapshotKnowledge(room.knowledge),
      dispatchChain: [proposal.targetTemplateId]
    };

    const job = await this.store.createJob({
      projectId: input.projectId,
      memberId: targetMember.memberId,
      messageId: null,
      brief: targetBrief,
      status: "queued",
      threadId: message.threadId
    });
    this.emit({ type: "job", projectId: input.projectId, job });

    const updatedMessage = await this.store.updateMessageProposal(input.messageId, input.proposalId, {
      status: "dispatched",
      dispatchedJobId: job.jobId,
      resolvedAtMs: Date.now()
    });
    this.emit({ type: "messageUpdate", projectId: input.projectId, message: updatedMessage });

    const exclusive = this.store.memberNeedsExclusiveLock(targetMember);
    const exclusiveBusy = Boolean(await this.store.findActiveWriterJob(input.projectId));
    const startNow = !exclusive || !exclusiveBusy;
    if (startNow) {
      this.launchJob(job.jobId, targetMember);
    }
    return { message: updatedMessage, job };
  }

  async resumeJob(jobId: string): Promise<{ job: ImJob }> {
    const job = await this.store.getJob(jobId);
    if (!job) throw new Error("Job not found.");
    if (job.status !== "cancelled" && job.status !== "failed") {
      throw new Error("Only interrupted jobs can be resumed.");
    }
    let member = await this.store.getMember(job.memberId);
    if (!member?.enabled) throw new Error("Target role is not enabled in this room.");
    if (!member.acpChatId && job.acpChatId) {
      member = await this.store.setMemberAcpChatId(member.memberId, job.acpChatId);
      this.emit({ type: "member", projectId: job.projectId, member });
    }

    const room = await this.store.getRoom(job.projectId);
    if (room.jobs.some((item) => item.memberId === job.memberId && item.createdAtMs > job.createdAtMs)) {
      throw new Error("A newer job already exists for this role.");
    }
    const draft = [...room.messages]
      .reverse()
      .find((message) => message.jobId === job.jobId && message.kind === "role.say");
    const nextBrief: ImJobBrief = {
      ...job.brief,
      instruction: buildResumeInstruction(job.brief.instruction, draft)
    };
    const nextJob = await this.store.createJob({
      projectId: job.projectId,
      memberId: job.memberId,
      messageId: job.messageId,
      brief: nextBrief,
      status: "queued",
      threadId: job.threadId || draft?.threadId || job.jobId
    });
    this.emit({ type: "job", projectId: job.projectId, job: nextJob });

    for (const message of room.messages) {
      const proposal = message.delegationProposals?.find((item) => item.dispatchedJobId === job.jobId);
      if (!proposal) continue;
      const updatedMessage = await this.store.updateMessageProposal(message.messageId, proposal.id, {
        dispatchedJobId: nextJob.jobId
      });
      this.emit({ type: "messageUpdate", projectId: job.projectId, message: updatedMessage });
    }

    const exclusive = this.store.memberNeedsExclusiveLock(member);
    const exclusiveBusy = Boolean(await this.store.findActiveWriterJob(job.projectId));
    if (!exclusive || !exclusiveBusy) {
      this.launchJob(nextJob.jobId, member);
    }
    return { job: nextJob };
  }

  async dismissProposal(input: {
    projectId: string;
    messageId: string;
    proposalId: string;
  }): Promise<ImMessage> {
    const updatedMessage = await this.store.updateMessageProposal(input.messageId, input.proposalId, {
      status: "dismissed",
      resolvedAtMs: Date.now()
    });
    this.emit({ type: "messageUpdate", projectId: input.projectId, message: updatedMessage });
    return updatedMessage;
  }

  private async runJob(jobId: string): Promise<void> {
    const job = await this.store.getJob(jobId);
    if (!job) return;
    const member = await this.store.getMember(job.memberId);
    if (!member) throw new Error("Room member not found.");
    const template = await this.store.getTemplate(member.templateId);
    const agent = member.agent || template?.agent || "claude";
    const model = member.model || template?.model || undefined;
    const thoughtLevel = member.thoughtLevel || template?.thoughtLevel || undefined;
    const settings = await loadSettings();
    const panelHome = effectivePanelHome(settings);
    const cwd = await this.store.ensureProjectLocalPath(job.projectId, panelHome);
    if (!isImAgent(agent)) throw new Error("IM only supports Pi, Claude Code, and Codex.");

    let connecting = await this.store.updateJob(jobId, { status: "connecting" });
    this.emit({ type: "job", projectId: job.projectId, job: connecting });
    let chatId = member.acpChatId;
    let reusedExistingChat = false;
    if (chatId) {
      const existing = await getAcpRecord(panelHome, chatId);
      if (!existing || existing.provider !== agent || existing.projectPath !== cwd) {
        chatId = null;
      } else {
        reusedExistingChat = true;
      }
    }
    if (!chatId) {
      const record = await createAcpRecord(panelHome, cwd, agent as AcpAgentProvider, { source: "im" });
      chatId = record.id;
      const updatedMember = await this.store.setMemberAcpChatId(member.memberId, chatId);
      this.emit({ type: "member", projectId: job.projectId, member: updatedMember });
    }

    connecting = await this.store.updateJob(jobId, { acpChatId: chatId, status: "connecting" });
    this.jobsByChat.set(chatId, jobId);
    this.emit({ type: "job", projectId: job.projectId, job: connecting });

    if (this.inspectChat?.(chatId)?.running) {
      await this.waitForChatIdle(chatId);
    }
    const connectResult = await this.connectChat(chatId);
    const sessionRebuilt = Boolean(connectResult && typeof connectResult === "object" && connectResult.rebuilt);
    if (model && this.setModel) {
      try {
        await this.setModel(chatId, model);
      } catch (error) {
        console.warn(`[IM Conductor] Failed to set model ${model} on chat ${chatId}:`, error);
      }
    }
    if (thoughtLevel && this.setThoughtLevel) {
      try {
        await this.setThoughtLevel(chatId, thoughtLevel);
      } catch (error) {
        console.warn(`[IM Conductor] Failed to set thought level ${thoughtLevel} on chat ${chatId}:`, error);
      }
    }
    const running = await this.store.updateJob(jobId, { status: "running", acpChatId: chatId });
    this.emit({ type: "job", projectId: job.projectId, job: running });

    const room = await this.store.getRoom(job.projectId);
    const enabledMembers = room.members.filter((m) => m.enabled && m.memberId !== member.memberId);
    const allowedCalleeIds = member.callableTemplateIds ?? (
      isBuiltinTemplateId(member.templateId) ? [...DEFAULT_BUILTIN_CALLABLE_TEMPLATE_IDS[member.templateId]] : []
    );
    const callableMembers = enabledMembers
      .filter((m) => allowedCalleeIds.includes(m.templateId))
      .map((m) => ({ templateId: m.templateId, name: m.name, persona: m.persona }));
    const useIncremental = reusedExistingChat && !sessionRebuilt;
    if (reusedExistingChat && sessionRebuilt) {
      const notice = await this.store.insertMessage({
        projectId: job.projectId,
        kind: "system",
        authorLabel: "IM",
        body: "desktop.im.sessionRebuilt",
        jobId,
        threadId: job.threadId
      });
      this.emit({ type: "message", projectId: job.projectId, message: notice });
    }
    let skillsPrompt = "";
    try {
      const skills = await discoverSkills({ projectPath: cwd, panelHome });
      skillsPrompt = formatSkillsCatalogPrompt(skills);
    } catch {
      // ignore
    }
    const prompt = useIncremental
      ? buildIncrementalPrompt(job.brief)
      : buildDispatchPrompt(job.brief, callableMembers, skillsPrompt);
    const imagesToPass: Array<{ mimeType: string; fileName: string; data: string }> = [];
    if (job.brief.images?.length) {
      for (const img of job.brief.images) {
        if (img.previewUrl && img.previewUrl.startsWith("data:")) {
          const data = img.previewUrl.split(",")[1] || "";
          imagesToPass.push({ fileName: img.fileName, mimeType: img.mimeType, data });
        } else if (img.storagePath) {
          const abs = path.join(path.resolve(expandHome(panelHome)), img.storagePath);
          const buf = await fs.readFile(abs).catch(() => null);
          if (buf) {
            imagesToPass.push({ fileName: img.fileName, mimeType: img.mimeType, data: buf.toString("base64") });
          }
        }
      }
    }
    await this.promptAndWait(chatId, prompt, imagesToPass);

    await this.flushStreamingMessage(jobId);
    this.forgetStreamingMessage(jobId);

    const latest = await this.store.getJob(jobId);
    if (!latest || latest.status === "failed" || latest.status === "cancelled") return;
    const completed = await this.store.updateJob(jobId, {
      status: "completed",
      permission: null,
      finished: true
    });
    this.emit({ type: "job", projectId: completed.projectId, job: completed });
    this.jobsByChat.delete(chatId);
    try {
      await this.pumpExclusiveQueue(completed.projectId);
    } catch {
      // ignore queue errors after teardown
    }
  }

  private async performAsyncIntentRouting(options: {
    projectId: string;
    message: ImMessage;
    text: string;
    enabledMembers: ImMember[];
    quotes: ImQuotedMessage[];
    knowledge: ImKnowledgeSnapshot[];
    savedImages: ImImageAttachment[];
    settings: PanelSettings;
    panelHome: string;
  }): Promise<void> {
    try {
      const routeResult = await routeMessageIntent({
        text: options.text,
        roomMembers: options.enabledMembers,
        settings: options.settings,
        desktopDb: desktopDbPath(options.panelHome)
      });
      if (routeResult.matched && routeResult.targetMemberId) {
        const targetMember = options.enabledMembers.find((m) => m.memberId === routeResult.targetMemberId);
        if (targetMember) {
          const updatedMessage = await this.store.updateMessageRouting(options.message.messageId, {
            autoRouted: true,
            routedRoleName: targetMember.name
          });
          this.emit({ type: "messageUpdate", projectId: options.projectId, message: updatedMessage });

          const targetTemplate = await this.store.getTemplate(targetMember.templateId);
          const targetPersona = targetTemplate?.persona ?? targetMember.persona;
          const targetCwd = await this.store.ensureProjectLocalPath(options.projectId, options.panelHome);
          const exclusive = this.store.memberNeedsExclusiveLock(targetMember);
          const exclusiveBusy = Boolean(await this.store.findActiveWriterJob(options.projectId));
          const startNow = !exclusive || !exclusiveBusy;

          const threadId = options.message.threadId || crypto.randomUUID();
          if (!options.message.threadId) {
            await this.store.setMessageThreadId(options.message.messageId, threadId);
          }
          const job = await this.store.createJob({
            projectId: options.projectId,
            memberId: targetMember.memberId,
            messageId: options.message.messageId,
            brief: {
              persona: targetPersona,
              instruction: options.text,
              cwd: targetCwd,
              quotes: options.quotes,
              knowledge: options.knowledge,
              images: options.savedImages.length ? options.savedImages : undefined,
              dispatchChain: [targetMember.templateId]
            },
            status: "queued",
            threadId
          });
          await this.store.attachJobToMessage(options.message.messageId, job.jobId);
          this.emit({ type: "job", projectId: options.projectId, job });
          if (startNow) this.launchJob(job.jobId, targetMember);
        }
      } else if (routeResult.tip) {
        const updatedMessage = await this.store.updateMessageRouting(options.message.messageId, {
          routingTip: routeResult.tip,
          routingTimedOut: Boolean(routeResult.timedOut)
        });
        this.emit({ type: "messageUpdate", projectId: options.projectId, message: updatedMessage });
      }
    } catch (error) {
      console.warn("[IM Conductor] Async intent routing failed:", error);
    }
  }

  private async pumpExclusiveQueue(projectId: string): Promise<void> {
    if (await this.store.findActiveWriterJob(projectId)) return;
    const next = (await this.store.listQueuedExclusiveJobs(projectId))[0];
    if (!next) return;
    const member = await this.store.getMember(next.memberId);
    if (!member) return;
    this.launchJob(next.jobId, member);
  }

  async adoptLiveJobs(liveChatIds: string[]): Promise<void> {
    for (const chatId of liveChatIds) {
      if (!chatId) continue;
      const active = await this.store.findJobByAcpChatId(chatId);
      if (active) {
        this.jobsByChat.set(chatId, active.jobId);
        continue;
      }
      const interrupted = await this.store.findInterruptedJobByAcpChatId(chatId);
      if (!interrupted) continue;
      const state = this.inspectChat?.(chatId);
      if (!state?.live && !state?.running) continue;
      const revived = await this.store.updateJob(interrupted.jobId, {
        status: state.running ? "running" : "connecting",
        error: null,
        finished: false
      });
      this.jobsByChat.set(chatId, revived.jobId);
      this.emit({ type: "job", projectId: revived.projectId, job: revived });
    }
  }

  private async waitForChatIdle(chatId: string, timeoutMs = 120_000): Promise<void> {
    const started = Date.now();
    while (this.inspectChat?.(chatId)?.running) {
      if (Date.now() - started > timeoutMs) {
        throw new Error("ACP session is still running the previous turn.");
      }
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }

  private promptAndWait(
    chatId: string,
    text: string,
    images: Array<{ mimeType: string; fileName: string; data: string }> = []
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      this.pendingByChat.set(chatId, {
        resolve: () => {
          this.pendingByChat.delete(chatId);
          resolve();
        },
        reject: (error) => {
          this.pendingByChat.delete(chatId);
          reject(error);
        }
      });
      void this.promptChat(chatId, text, images).then(
        () => this.pendingByChat.get(chatId)?.resolve(),
        (error: unknown) => {
          const next = error instanceof Error ? error : new Error(String(error));
          this.pendingByChat.get(chatId)?.reject(next);
        }
      );
    });
  }

  private settlePrompt(chatId: string, error?: Error): void {
    const pending = this.pendingByChat.get(chatId);
    if (!pending) return;
    if (error) pending.reject(error);
    else pending.resolve();
  }

  async flushStreamingMessages(): Promise<void> {
    const jobIds = [...this.streamingMessagesByJob.keys()];
    await Promise.all(jobIds.map((jobId) => this.flushStreamingMessage(jobId)));
  }

  private scheduleStreamingPersist(jobId: string): void {
    const last = this.streamingPersistAt.get(jobId) ?? 0;
    const now = Date.now();
    if (now - last < STREAM_PERSIST_MS) return;
    this.streamingPersistAt.set(jobId, now);
    void this.flushStreamingMessage(jobId);
  }

  private async flushStreamingMessage(jobId: string): Promise<void> {
    const streamMsg = this.streamingMessagesByJob.get(jobId);
    if (!streamMsg?.body && !streamMsg?.thinking) return;
    await this.persistStreamingMessage(jobId);
  }

  private persistStreamingMessage(
    jobId: string,
    patch?: {
      body?: string;
      thinking?: string;
      delegationProposals?: ImDelegationProposal[];
    }
  ): Promise<ImMessage> {
    const previous = this.streamingPersistChain.get(jobId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(() => this.writeStreamingMessage(jobId, patch));
    this.streamingPersistChain.set(jobId, next.then(() => undefined, () => undefined));
    return next;
  }

  private async writeStreamingMessage(
    jobId: string,
    patch?: {
      body?: string;
      thinking?: string;
      delegationProposals?: ImDelegationProposal[];
    }
  ): Promise<ImMessage> {
    const streamMsg = this.streamingMessagesByJob.get(jobId);
    if (!streamMsg) throw new Error("Streaming message not found.");
    const body = patch?.body ?? streamMsg.body;
    const thinking = patch?.thinking ?? streamMsg.thinking;
    const proposals = patch?.delegationProposals;
    if (this.persistedStreamingIds.has(streamMsg.messageId)) {
      return this.store.updateMessage(streamMsg.messageId, {
        body,
        thinking: thinking ?? null,
        delegationProposals: proposals
      });
    }
    const created = await this.store.insertMessage({
      messageId: streamMsg.messageId,
      projectId: streamMsg.projectId,
      kind: "role.say",
      authorMemberId: streamMsg.authorMemberId,
      authorLabel: streamMsg.authorLabel,
      body,
      thinking,
      delegationProposals: proposals?.length ? proposals : undefined,
      jobId,
      threadId: streamMsg.threadId
    });
    this.persistedStreamingIds.add(streamMsg.messageId);
    return created;
  }

  private forgetStreamingMessage(jobId: string): void {
    const streamMsg = this.streamingMessagesByJob.get(jobId);
    this.streamingMessagesByJob.delete(jobId);
    this.streamingPersistAt.delete(jobId);
    this.streamingPersistChain.delete(jobId);
    if (streamMsg) this.persistedStreamingIds.delete(streamMsg.messageId);
  }
}

const pendingImEvents = new Map<string, { getMainWindow: () => BrowserWindow | null; event: ImEvent; timer: ReturnType<typeof setTimeout> }>();

export function emitImEvent(getMainWindow: () => BrowserWindow | null, event: ImEvent): void {
  const win = getMainWindow();
  if (!win || win.isDestroyed()) return;

  // Coalesce cumulative streaming updates per message. This keeps the renderer
  // at roughly one IPC update per frame without delaying discrete state events.
  if (event.type === "messageUpdate" && event.message.streaming) {
    const key = `${event.projectId}:${event.message.messageId}`;
    const existing = pendingImEvents.get(key);
    if (existing) {
      existing.event = event;
      return;
    }
    const timer = setTimeout(() => {
      const pending = pendingImEvents.get(key);
      if (!pending) return;
      pendingImEvents.delete(key);
      const target = pending.getMainWindow();
      if (target && !target.isDestroyed()) {
        target.webContents.send("im:event", pending.event);
      }
    }, 16);
    pendingImEvents.set(key, { getMainWindow, event, timer });
    return;
  }

  win.webContents.send("im:event", event);
}
