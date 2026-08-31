import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../acp/store", () => ({
  createAcpRecord: vi.fn(async (_home: string, projectPath: string, provider: string) => ({
    id: `chat-${provider}`,
    title: "test",
    projectPath,
    provider,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messageCount: 0
  })),
  getAcpRecord: vi.fn(async () => undefined)
}));

vi.mock("@agent-resume/core", async () => {
  const actual = await vi.importActual<typeof import("@agent-resume/core")>("@agent-resume/core");
  return {
    ...actual,
    loadSettings: vi.fn(async () => ({ panelHome: os.tmpdir() })),
    effectivePanelHome: () => os.tmpdir()
  };
});

import { desktopDbPath, ensureDesktopDbSchema } from "@agent-resume/core";
import { ImConductor } from "./conductor";
import { ImStore } from "./store";

const homes: string[] = [];

async function createStore(): Promise<ImStore> {
  const panelHome = await fs.mkdtemp(path.join(os.tmpdir(), "agent-resume-im-"));
  homes.push(panelHome);
  const dbPath = desktopDbPath(panelHome);
  await fs.mkdir(path.dirname(dbPath), { recursive: true });
  await ensureDesktopDbSchema(dbPath);
  const store = new ImStore(dbPath);
  await store.initialize();
  return store;
}

afterEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 150));
  await Promise.all(homes.splice(0).map((home) => fs.rm(home, { recursive: true, force: true })));
});

describe("ImConductor", () => {
  it("does not dispatch when the user does not mention a role", async () => {
    const store = await createStore();
    const project = await store.createProject("No mention");
    const connect = vi.fn(async () => undefined);
    const prompt = vi.fn(async () => undefined);
    const conductor = new ImConductor(store, () => undefined, connect, prompt);
    const result = await conductor.postMessage({
      projectId: project.projectId,
      body: "just a note",
      quoteIds: [],
      mentionRoleIds: []
    });
    expect(result.job).toBeNull();
    expect(connect).not.toHaveBeenCalled();
  });

  it("fans out read-only mentions in parallel and queues exclusive roles", async () => {
    const store = await createStore();
    const project = await store.createProject("Fanout");
    await store.setLocalPath(project.projectId, process.cwd());
    const room = await store.getRoom(project.projectId);
    const pm = room.members.find((member) => member.templateId === "role_product_manager")!;
    const designer = room.members.find((member) => member.templateId === "role_ui_designer")!;
    const developer = room.members.find((member) => member.templateId === "role_developer")!;
    const tester = room.members.find((member) => member.templateId === "role_tester")!;
    const connect = vi.fn(async () => undefined);
    const prompt = vi.fn(async () => undefined);
    const conductor = new ImConductor(store, () => undefined, connect, prompt);
    await conductor.postMessage({
      projectId: project.projectId,
      body: "review this",
      quoteIds: [],
      mentionRoleIds: [pm.memberId, designer.memberId, developer.memberId, tester.memberId]
    });
    const jobs = await store.listJobs(project.projectId);
    expect(jobs).toHaveLength(4);
    expect(new Set(jobs.map((job) => job.memberId))).toEqual(new Set([
      pm.memberId,
      designer.memberId,
      developer.memberId,
      tester.memberId
    ]));
    const exclusiveQueued = (await store.listQueuedExclusiveJobs(project.projectId)).map((job) => job.memberId);
    expect(exclusiveQueued.length).toBeGreaterThanOrEqual(1);
    expect(exclusiveQueued.every((id) => id === developer.memberId || id === tester.memberId)).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 50));
  });

  it("keeps tool-call activity off the transcript", async () => {
    const store = await createStore();
    const project = await store.createProject("Quiet tools");
    const room = await store.getRoom(project.projectId);
    const pm = room.members.find((member) => member.templateId === "role_product_manager")!;
    const conductor = new ImConductor(store, () => undefined, vi.fn(async () => undefined), vi.fn(async () => undefined));
    const job = await store.createJob({
      projectId: project.projectId,
      memberId: pm.memberId,
      messageId: null,
      brief: { persona: pm.persona, instruction: "summarize", cwd: process.cwd(), quotes: [], knowledge: [] },
      status: "running"
    });
    await store.updateJob(job.jobId, { acpChatId: "chat-quiet" });
    await conductor.handleAcpStream({
      type: "assistantDelta",
      chatId: "chat-quiet",
      id: "delta-1",
      text: "",
      streaming: true,
      toolCalls: [{
        toolCallId: "tool-1",
        title: "Read",
        kind: "read",
        status: "completed",
        locations: [{ path: "README.md" }]
      }]
    });
    await conductor.handleAcpStream({
      type: "assistantDone",
      chatId: "chat-quiet",
      streaming: false,
      message: {
        id: "msg-1",
        role: "assistant",
        text: "The repo is a desktop IM app.",
        timestamp: Date.now(),
        toolCalls: [{
          toolCallId: "tool-1",
          title: "Read",
          kind: "read",
          status: "completed",
          locations: [{ path: "README.md" }]
        }]
      }
    });
    const messages = await store.listMessages(project.projectId);
    expect(messages.filter((item) => item.kind === "job.card")).toHaveLength(0);
    expect(messages.some((item) => item.kind === "role.say" && item.body === "The repo is a desktop IM app.")).toBe(true);
  });

  it("refuses dispatch until a local folder is associated", async () => {
    const store = await createStore();
    const project = await store.createProject("No folder");
    const room = await store.getRoom(project.projectId);
    const conductor = new ImConductor(store, () => undefined, vi.fn(async () => undefined), vi.fn(async () => undefined));
    await expect(conductor.postMessage({
      projectId: project.projectId,
      body: "please implement this",
      quoteIds: [],
      mentionRoleIds: [room.members[0]!.memberId]
    })).rejects.toThrow(/local folder/i);
  });

  it("sets model dynamically when dispatching a job for a role with configured model", async () => {
    const store = await createStore();
    const project = await store.createProject("Model dispatch");
    await store.setLocalPath(project.projectId, process.cwd());
    const architect = await store.createTemplate({
      name: "Architect",
      persona: "Lead Architect.",
      agent: "claude",
      model: "claude-opus"
    });
    const member = await store.addMember(project.projectId, architect.templateId);

    const connect = vi.fn(async () => undefined);
    const prompt = vi.fn(async () => undefined);
    const setModel = vi.fn(async () => undefined);
    const conductor = new ImConductor(store, () => undefined, connect, prompt, undefined, setModel);

    await conductor.postMessage({
      projectId: project.projectId,
      body: "Plan architecture",
      quoteIds: [],
      mentionRoleIds: [member.memberId]
    });

    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(connect).toHaveBeenCalled();
    expect(setModel).toHaveBeenCalledWith(expect.any(String), "claude-opus");
    expect(prompt).toHaveBeenCalled();
  });

  it("streams assistant text and thinking deltas in real-time and persists on done", async () => {
    const store = await createStore();
    const project = await store.createProject("Streaming test");
    const room = await store.getRoom(project.projectId);
    const pm = room.members.find((member) => member.templateId === "role_product_manager")!;
    const emittedEvents: any[] = [];
    const conductor = new ImConductor(store, (event) => emittedEvents.push(event), vi.fn(async () => undefined), vi.fn(async () => undefined));

    const job = await store.createJob({
      projectId: project.projectId,
      memberId: pm.memberId,
      messageId: null,
      brief: { persona: pm.persona, instruction: "plan", cwd: process.cwd(), quotes: [], knowledge: [] },
      status: "running"
    });
    await store.updateJob(job.jobId, { acpChatId: "chat-stream-1" });

    // Step 1: Thinking delta
    await conductor.handleAcpStream({
      type: "assistantDelta",
      chatId: "chat-stream-1",
      id: "delta-1",
      text: "",
      thinking: "Analyzing requirements...",
      streaming: true,
      toolCalls: []
    });

    const firstMsgEvent = emittedEvents.find((e) => e.type === "message");
    expect(firstMsgEvent).toBeDefined();
    expect(firstMsgEvent.message.thinking).toBe("Analyzing requirements...");
    expect(firstMsgEvent.message.streaming).toBe(true);

    // Step 2: Content text delta
    await conductor.handleAcpStream({
      type: "assistantDelta",
      chatId: "chat-stream-1",
      id: "delta-2",
      text: "Here is the plan.",
      thinking: "Analyzing requirements...",
      streaming: true,
      toolCalls: []
    });

    const updateEvent = emittedEvents.filter((e) => e.type === "messageUpdate").at(-1);
    expect(updateEvent).toBeDefined();
    expect(updateEvent.message.body).toBe("Here is the plan.");
    expect(updateEvent.message.thinking).toBe("Analyzing requirements...");
    expect(updateEvent.message.streaming).toBe(true);

    // Step 3: Done
    await conductor.handleAcpStream({
      type: "assistantDone",
      chatId: "chat-stream-1",
      streaming: false,
      message: {
        id: "msg-done",
        role: "assistant",
        text: "Here is the plan. All set.",
        thinking: "Analyzing requirements... Done.",
        timestamp: Date.now(),
        toolCalls: []
      }
    });

    const finalMessages = await store.listMessages(project.projectId);
    expect(finalMessages).toHaveLength(1);
    expect(finalMessages[0]?.body).toBe("Here is the plan. All set.");
    expect(finalMessages[0]?.thinking).toBe("Analyzing requirements... Done.");
  });
});
