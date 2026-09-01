import type { BrowserWindow } from "electron";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { desktopDbPath, effectivePanelHome, expandHome, loadSettings } from "@agent-resume/core";
import { createAcpRecord, getAcpRecord } from "../acp/store";
import type { AcpAgentProvider, AcpStreamEvent, AcpToolCallInfo } from "../acp/types";
import { routeMessageIntent } from "./intentRouter";
import { buildDispatchPrompt, extractFirstQuestionTitle, isDefaultChatName, saveImMessageImage, type ImStore } from "./store";
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
  type ImMember,
  type ImMessage,
  type ImRoleTools
} from "./types";

type ConnectFn = (chatId: string) => Promise<void>;
type PromptFn = (
  chatId: string,
  text: string,
  images?: Array<{ mimeType: string; fileName: string; data: string }>
) => Promise<void>;
type DenyPermissionFn = (requestId: string) => Promise<void>;
type SetModelFn = (chatId: string, modelId: string) => Promise<void>;
type SetThoughtLevelFn = (chatId: string, thoughtLevel: string) => Promise<void>;

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
      (lower === "developer" && m.templateId === "role_developer") ||
      (lower === "architect" && m.templateId === "role_architect") ||
      (lower === "pm" && m.templateId === "role_product_manager") ||
      (lower === "tester" && m.templateId === "role_tester") ||
      (lower === "qa" && m.templateId === "role_tester") ||
      (lower === "ui" && m.templateId === "role_ui_designer")
    );
  }

  // Security check: Must be in allowedCalleeIds
  if (found && allowedCalleeIds.includes(found.templateId)) {
    return found;
  }
  return undefined;
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

export class ImConductor {
  private readonly jobsByChat = new Map<string, string>();
  private readonly pendingByChat = new Map<string, { resolve: () => void; reject: (error: Error) => void }>();
  private readonly streamingMessagesByJob = new Map<string, ImMessage>();

  constructor(
    private readonly store: ImStore,
    private readonly emit: (event: ImEvent) => void,
    private readonly connectChat: ConnectFn,
    private readonly promptChat: PromptFn,
    private readonly denyPermission?: DenyPermissionFn,
    private readonly setModel?: SetModelFn,
    private readonly setThoughtLevel?: SetThoughtLevelFn
  ) {}

  async postMessage(input: {
    projectId: string;
    body: string;
    quoteIds: string[];
    mentionRoleIds: string[];
    images?: Array<{ fileName: string; mimeType: string; data: string }>;
  }): Promise<{ message: Awaited<ReturnType<ImStore["insertMessage"]>>; job: ImJob | null }> {
    const room = await this.store.getRoom(input.projectId);
    const body = this.store.clipInstruction(input.body);
    const hasImages = Boolean(input.images?.length);
    if (!body.trim() && !input.quoteIds.length && !hasImages) {
      throw new Error("Message is empty.");
    }
    const mentionIds = [...new Set(input.mentionRoleIds.filter(Boolean))];
    const quotes = await this.store.resolveQuotes(input.projectId, input.quoteIds);
    const settings = await loadSettings();
    const panelHome = effectivePanelHome(settings);
    const cwd = mentionIds.length
      ? await this.store.ensureProjectLocalPath(input.projectId, panelHome)
      : room.project.localPath;
    const savedImages: ImImageAttachment[] = [];
    if (input.images?.length) {
      for (const img of input.images) {
        const saved = await saveImMessageImage(panelHome, input.projectId, img);
        savedImages.push(saved);
      }
    }

    const message = await this.store.insertMessage({
      projectId: input.projectId,
      kind: "human",
      authorLabel: "You",
      body: body.trim() || (savedImages.length ? "(attached images)" : "(quoted messages)"),
      images: savedImages.length ? savedImages : undefined,
      quoteIds: quotes.map((quote) => quote.messageId),
      mentionRoleIds: mentionIds
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

    if (!mentionIds.length) {
      if (body.trim()) {
        const enabledMembers = room.members.filter((m) => m.enabled);
        if (enabledMembers.length > 0) {
          const routeResult = await routeMessageIntent({
            text: body.trim(),
            roomMembers: enabledMembers,
            settings,
            desktopDb: desktopDbPath(panelHome)
          });
          if (routeResult.matched && routeResult.targetMemberId) {
            const targetMember = enabledMembers.find((m) => m.memberId === routeResult.targetMemberId);
            if (targetMember) {
              const updatedMessage = await this.store.updateMessageRouting(message.messageId, {
                autoRouted: true,
                routedRoleName: targetMember.name
              });
              this.emit({ type: "messageUpdate", projectId: input.projectId, message: updatedMessage });

              const targetTemplate = await this.store.getTemplate(targetMember.templateId);
              const targetPersona = targetTemplate?.persona ?? targetMember.persona;
              const targetCwd = await this.store.ensureProjectLocalPath(input.projectId, panelHome);
              const exclusive = this.store.memberNeedsExclusiveLock(targetMember);
              const exclusiveBusy = Boolean(await this.store.findActiveWriterJob(input.projectId));
              const startNow = !exclusive || !exclusiveBusy;

              const job = await this.store.createJob({
                projectId: input.projectId,
                memberId: targetMember.memberId,
                messageId: message.messageId,
                brief: {
                  persona: targetPersona,
                  instruction: body.trim(),
                  cwd: targetCwd,
                  quotes,
                  knowledge: this.store.snapshotKnowledge(room.knowledge),
                  images: savedImages.length ? savedImages : undefined,
                  dispatchChain: [targetMember.templateId]
                },
                status: "queued"
              });
              await this.store.attachJobToMessage(message.messageId, job.jobId);
              this.emit({ type: "job", projectId: input.projectId, job });
              if (startNow) this.launchJob(job.jobId, targetMember);
              return { message: updatedMessage, job };
            }
          } else if (routeResult.tip) {
            const updatedMessage = await this.store.updateMessageRouting(message.messageId, {
              routingTip: routeResult.tip,
              routingTimedOut: Boolean(routeResult.timedOut)
            });
            this.emit({ type: "messageUpdate", projectId: input.projectId, message: updatedMessage });
            return { message: updatedMessage, job: null };
          }
        }
      }
      return { message, job: null };
    }

    const knowledge = this.store.snapshotKnowledge(room.knowledge);
    const jobs: ImJob[] = [];
    let exclusiveBusy = Boolean(await this.store.findActiveWriterJob(input.projectId));
    for (const mentionId of mentionIds) {
      const member = room.members.find((item) => item.memberId === mentionId && item.enabled);
      if (!member) throw new Error("Mentioned role is not in this room.");
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
          quotes,
          knowledge,
          images: savedImages.length ? savedImages : undefined
        },
        status: "queued"
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
    this.streamingMessagesByJob.delete(jobId);
    const cancelled = await this.store.cancelJob(jobId);
    this.emit({ type: "job", projectId: cancelled.projectId, job: cancelled });
    const chatId = cancelled.acpChatId;
    if (chatId) {
      this.jobsByChat.delete(chatId);
      this.settlePrompt(chatId, new Error("Job cancelled by user"));
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
    const jobId = this.jobsByChat.get(chatId) ?? (await this.store.findJobByAcpChatId(chatId))?.jobId;
    if (!jobId) return;
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
      const job = await this.store.updateJob(jobId, {
        status: "running",
        filesChanged
      });
      this.emit({ type: "job", projectId: job.projectId, job });

      const text = event.text || "";
      const thinking = event.thinking || "";
      if (text || thinking) {
        let streamMsg = this.streamingMessagesByJob.get(jobId);
        if (!streamMsg) {
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
            createdAtMs: Date.now()
          };
          this.streamingMessagesByJob.set(jobId, streamMsg);
          this.emit({ type: "message", projectId: current.projectId, message: streamMsg });
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
        this.streamingMessagesByJob.delete(jobId);
        if (finalBody || finalThinking) {
          persistedMessage = await this.store.insertMessage({
            messageId: streamMsg.messageId,
            projectId: job.projectId,
            kind: "role.say",
            authorMemberId: job.memberId,
            authorLabel: streamMsg.authorLabel,
            body: finalBody,
            thinking: finalThinking,
            delegationProposals: proposals.length ? proposals : undefined,
            jobId
          });
          this.emit({
            type: "messageUpdate",
            projectId: job.projectId,
            message: { ...persistedMessage, streaming: false }
          });
        }
      } else if (finalBody || finalThinking) {
        const member = await this.store.getMember(job.memberId);
        persistedMessage = await this.store.insertMessage({
          projectId: job.projectId,
          kind: "role.say",
          authorMemberId: job.memberId,
          authorLabel: member?.name || "Role",
          body: finalBody,
          thinking: finalThinking,
          delegationProposals: proposals.length ? proposals : undefined,
          jobId
        });
        this.emit({ type: "message", projectId: job.projectId, message: { ...persistedMessage, streaming: false } });
      }

      if (proposals.length > 0 && persistedMessage) {
        await this.executeAutoDispatches(job, persistedMessage.messageId, proposals);
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
    messageId: string,
    proposals: ImDelegationProposal[]
  ): Promise<void> {
    const member = await this.store.getMember(job.memberId);
    if (!member || !member.autoDispatch) return;
    const room = await this.store.getRoom(job.projectId);
    const chain = job.brief.dispatchChain ?? [member.templateId];
    const MAX_CHAIN_DEPTH = 5;

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
        quotes: job.brief.quotes,
        knowledge: job.brief.knowledge,
        dispatchChain: [...chain, targetMember.templateId]
      };
      const nextJob = await this.store.createJob({
        projectId: job.projectId,
        memberId: targetMember.memberId,
        messageId: null,
        brief: targetBrief,
        status: "queued"
      });
      proposal.dispatchedJobId = nextJob.jobId;
      proposal.resolvedAtMs = Date.now();
      await this.store.updateMessageProposal(messageId, proposal.id, {
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

    const targetBrief: ImJobBrief = {
      persona: targetPersona,
      instruction: proposal.instruction,
      cwd,
      quotes: message.quotes,
      knowledge: this.store.snapshotKnowledge(room.knowledge),
      dispatchChain: [proposal.targetTemplateId]
    };

    const job = await this.store.createJob({
      projectId: input.projectId,
      memberId: targetMember.memberId,
      messageId: null,
      brief: targetBrief,
      status: "queued"
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
    if (chatId) {
      const existing = await getAcpRecord(panelHome, chatId);
      if (!existing || existing.provider !== agent || existing.projectPath !== cwd) {
        chatId = null;
      }
    }
    if (!chatId) {
      const record = await createAcpRecord(panelHome, cwd, agent as AcpAgentProvider);
      chatId = record.id;
      const updatedMember = await this.store.setMemberAcpChatId(member.memberId, chatId);
      this.emit({ type: "member", projectId: job.projectId, member: updatedMember });
    }

    connecting = await this.store.updateJob(jobId, { acpChatId: chatId, status: "connecting" });
    this.jobsByChat.set(chatId, jobId);
    this.emit({ type: "job", projectId: job.projectId, job: connecting });

    await this.connectChat(chatId);
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
    const prompt = buildDispatchPrompt(job.brief, callableMembers);
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

  private async pumpExclusiveQueue(projectId: string): Promise<void> {
    if (await this.store.findActiveWriterJob(projectId)) return;
    const next = (await this.store.listQueuedExclusiveJobs(projectId))[0];
    if (!next) return;
    const member = await this.store.getMember(next.memberId);
    if (!member) return;
    this.launchJob(next.jobId, member);
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
}

export function emitImEvent(getMainWindow: () => BrowserWindow | null, event: ImEvent): void {
  const win = getMainWindow();
  if (win && !win.isDestroyed()) {
    win.webContents.send("im:event", event);
  }
}
