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
});
