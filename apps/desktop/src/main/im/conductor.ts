import type { BrowserWindow } from "electron";
import { effectivePanelHome, loadSettings } from "@agent-resume/core";
import { createAcpRecord, getAcpRecord } from "../acp/store";
import type { AcpAgentProvider, AcpStreamEvent, AcpToolCallInfo } from "../acp/types";
import { buildDispatchPrompt, type ImStore } from "./store";
import { isImAgent, type ImEvent, type ImJob, type ImJobStatus, type ImMember, type ImRoleTools } from "./types";

type ConnectFn = (chatId: string) => Promise<void>;
type PromptFn = (chatId: string, text: string) => Promise<void>;
type DenyPermissionFn = (requestId: string) => Promise<void>;

const WRITER_BUSY: ReadonlySet<ImJobStatus> = new Set([
  "queued",
  "connecting",
  "running",
  "awaiting_user"
]);

function collectFiles(toolCalls: AcpToolCallInfo[] | undefined, current: string[]): string[] {
  if (!toolCalls?.length) return current;
  const next = new Set(current);
  for (const call of toolCalls) {
    const mutating = call.kind === "edit" || call.kind === "delete" || call.kind === "move" || call.kind === "write";
    if (!mutating) continue;
    for (const location of call.locations ?? []) {
      if (location.path) next.add(location.path);
    }
  }
  return [...next];
}

export class ImConductor {
  private readonly jobsByChat = new Map<string, string>();
  private readonly pendingByChat = new Map<string, { resolve: () => void; reject: (error: Error) => void }>();

  constructor(
    private readonly store: ImStore,
    private readonly emit: (event: ImEvent) => void,
    private readonly connectChat: ConnectFn,
    private readonly promptChat: PromptFn,
    private readonly denyPermission?: DenyPermissionFn
  ) {}

  async postMessage(input: {
    projectId: string;
    body: string;
    quoteIds: string[];
    mentionRoleIds: string[];
  }): Promise<{ message: Awaited<ReturnType<ImStore["insertMessage"]>>; job: ImJob | null }> {
    const room = await this.store.getRoom(input.projectId);
    const body = this.store.clipInstruction(input.body);
    if (!body.trim() && !input.quoteIds.length) {
      throw new Error("Message is empty.");
    }
    const mentionIds = [...new Set(input.mentionRoleIds.filter(Boolean))];
    const cwd = room.project.localPath;
    if (mentionIds.length && !cwd) {
      throw new Error("Associate a local folder before asking a role to work.");
    }
    const quotes = await this.store.resolveQuotes(input.projectId, input.quoteIds);
    const message = await this.store.insertMessage({
      projectId: input.projectId,
      kind: "human",
      authorLabel: "You",
      body: body.trim() || "(quoted messages)",
      quoteIds: quotes.map((quote) => quote.messageId),
      mentionRoleIds: mentionIds
    });
    this.emit({ type: "message", projectId: input.projectId, message });

    if (!mentionIds.length) {
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
          knowledge
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
      return;
    }

    if (event.type === "assistantDone") {
      const filesChanged = collectFiles(event.message.toolCalls, current.filesChanged);
      const job = await this.store.updateJob(jobId, { filesChanged, status: "running" });
      this.emit({ type: "job", projectId: job.projectId, job });
      if (event.message.text.trim()) {
        const member = await this.store.getMember(job.memberId);
        const say = await this.store.insertMessage({
          projectId: job.projectId,
          kind: "role.say",
          authorMemberId: job.memberId,
          authorLabel: member?.name || "Role",
          body: event.message.text.trim(),
          jobId
        });
        this.emit({ type: "message", projectId: job.projectId, message: say });
      }
    }
  }

  private async runJob(jobId: string): Promise<void> {
    const job = await this.store.getJob(jobId);
    if (!job) return;
    const member = await this.store.getMember(job.memberId);
    if (!member) throw new Error("Room member not found.");
    const template = await this.store.getTemplate(member.templateId);
    const agent = template?.agent ?? member.agent;
    const project = (await this.store.getRoom(job.projectId)).project;
    if (!project.localPath) throw new Error("Associate a local folder before asking a role to work.");
    if (!isImAgent(agent)) throw new Error("IM only supports Pi, Claude Code, and Codex.");

    let connecting = await this.store.updateJob(jobId, { status: "connecting" });
    this.emit({ type: "job", projectId: job.projectId, job: connecting });

    const settings = await loadSettings();
    const panelHome = effectivePanelHome(settings);
    let chatId = member.acpChatId;
    if (chatId) {
      const existing = await getAcpRecord(panelHome, chatId);
      if (!existing || existing.provider !== agent || existing.projectPath !== project.localPath) {
        chatId = null;
      }
    }
    if (!chatId) {
      const record = await createAcpRecord(panelHome, project.localPath, agent as AcpAgentProvider);
      chatId = record.id;
      const updatedMember = await this.store.setMemberAcpChatId(member.memberId, chatId);
      this.emit({ type: "member", projectId: job.projectId, member: updatedMember });
    }

    connecting = await this.store.updateJob(jobId, { acpChatId: chatId, status: "connecting" });
    this.jobsByChat.set(chatId, jobId);
    this.emit({ type: "job", projectId: job.projectId, job: connecting });

    await this.connectChat(chatId);
    const running = await this.store.updateJob(jobId, { status: "running", acpChatId: chatId });
    this.emit({ type: "job", projectId: job.projectId, job: running });

    const prompt = buildDispatchPrompt(job.brief);
    await this.promptAndWait(chatId, prompt);

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

  private promptAndWait(chatId: string, text: string): Promise<void> {
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
      void this.promptChat(chatId, text).then(
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
