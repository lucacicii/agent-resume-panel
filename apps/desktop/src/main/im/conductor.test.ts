import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../acp/store", () => {
  const acpRecords = new Map<string, {
    id: string;
    title: string;
    projectPath: string;
    provider: string;
    createdAt: number;
    updatedAt: number;
    messageCount: number;
  }>();
  return {
    createAcpRecord: vi.fn(async (_home: string, projectPath: string, provider: string, options?: { source?: string; title?: string }) => {
      const record = {
        id: `chat-${provider}-${acpRecords.size + 1}`,
        title: options?.title || "test",
        projectPath,
        provider,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messageCount: 0,
        source: options?.source || "acp"
      };
      acpRecords.set(record.id, record);
      return record;
    }),
    getAcpRecord: vi.fn(async (_home: string, chatId: string) => {
      const existing = acpRecords.get(chatId);
      if (existing) return existing;
      if (!chatId) return undefined;
      return {
        id: chatId,
        title: "test",
        projectPath: process.cwd(),
        provider: "claude",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messageCount: 0
      };
    })
  };
});

vi.mock("@agent-resume/core", async () => {
  const actual = await vi.importActual<typeof import("@agent-resume/core")>("@agent-resume/core");
  return {
    ...actual,
    loadSettings: vi.fn(async () => ({ panelHome: os.tmpdir() })),
    effectivePanelHome: () => os.tmpdir()
  };
});

import { desktopDbPath, ensureDesktopDbSchema } from "@agent-resume/core";
import { createAcpRecord } from "../acp/store";
import { ImConductor, parseDispatchBlocks, resolveDispatchTarget } from "./conductor";
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
  await Promise.all(homes.splice(0).map((home) => fs.rm(home, { recursive: true, force: true }).catch(() => undefined)));
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

  it("automatically renames a default chat to the user's first question", async () => {
    const store = await createStore();
    const project = await store.createProject("New chat");
    const emit = vi.fn();
    const conductor = new ImConductor(store, emit, vi.fn(async () => undefined), vi.fn(async () => undefined));

    await conductor.postMessage({
      projectId: project.projectId,
      body: "@Developer Help me design the authentication flow",
      quoteIds: [],
      mentionRoleIds: []
    });

    const updated = await store.getProject(project.projectId);
    expect(updated?.name).toBe("Help me design the authentication flow");
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ type: "room" }));
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

  it("creates a scratch folder and dispatches when no local folder is associated", async () => {
    const store = await createStore();
    const project = await store.createProject("No folder");
    expect(project.localPath).toBeNull();
    const room = await store.getRoom(project.projectId);
    const connect = vi.fn(async () => undefined);
    const prompt = vi.fn(async () => undefined);
    const conductor = new ImConductor(store, () => undefined, connect, prompt);
    const result = await conductor.postMessage({
      projectId: project.projectId,
      body: "please implement this",
      quoteIds: [],
      mentionRoleIds: [room.members[0]!.memberId]
    });
    expect(result.job).not.toBeNull();
    const updated = await store.getProject(project.projectId);
    expect(updated?.localPath).toMatch(/\.desktop\/scratch\/im\//);
    await expect(fs.stat(updated!.localPath!)).resolves.toMatchObject({ });
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

    await vi.waitFor(() => expect(prompt).toHaveBeenCalled(), { timeout: 3000 });
    expect(connect).toHaveBeenCalled();
    expect(setModel).toHaveBeenCalledWith(expect.any(String), "claude-opus");
  });

  it("prioritizes chat member agent and model override over template default", async () => {
    const store = await createStore();
    const project = await store.createProject("Override dispatch");
    await store.setLocalPath(project.projectId, process.cwd());
    const room = await store.getRoom(project.projectId);
    const dev = room.members.find((m) => m.templateId === "role_developer")!;

    // Override member to Codex + o3-mini in this chat
    await store.setMemberAgent(dev.memberId, "codex");
    await store.setMemberModel(dev.memberId, "o3-mini");

    const connect = vi.fn(async () => undefined);
    const prompt = vi.fn(async () => undefined);
    const setModel = vi.fn(async () => undefined);
    const conductor = new ImConductor(store, () => undefined, connect, prompt, undefined, setModel);

    await conductor.postMessage({
      projectId: project.projectId,
      body: "Write code with o3-mini",
      quoteIds: [],
      mentionRoleIds: [dev.memberId]
    });

    await vi.waitFor(() => expect(prompt).toHaveBeenCalled(), { timeout: 3000 });
    expect(connect).toHaveBeenCalled();
    expect(setModel).toHaveBeenCalledWith(expect.any(String), "o3-mini");
  });

  it("sets thought level after model when dispatching a job", async () => {
    const store = await createStore();
    const project = await store.createProject("Thought dispatch");
    await store.setLocalPath(project.projectId, process.cwd());
    const architect = await store.createTemplate({
      name: "Architect",
      persona: "Lead Architect.",
      agent: "codex",
      model: "o3-mini",
      thoughtLevel: "high"
    });
    const member = await store.addMember(project.projectId, architect.templateId);

    const connect = vi.fn(async () => undefined);
    const prompt = vi.fn(async () => undefined);
    const setModel = vi.fn(async () => undefined);
    const setThoughtLevel = vi.fn(async () => undefined);
    const conductor = new ImConductor(store, () => undefined, connect, prompt, undefined, setModel, setThoughtLevel);

    await conductor.postMessage({
      projectId: project.projectId,
      body: "Plan architecture",
      quoteIds: [],
      mentionRoleIds: [member.memberId]
    });

    await vi.waitFor(() => expect(prompt).toHaveBeenCalled(), { timeout: 3000 });
    expect(connect).toHaveBeenCalled();
    expect(setModel).toHaveBeenCalledWith(expect.any(String), "o3-mini");
    expect(setThoughtLevel).toHaveBeenCalledWith(expect.any(String), "high");
    expect(setModel.mock.invocationCallOrder[0]!).toBeLessThan(setThoughtLevel.mock.invocationCallOrder[0]!);
  });

  it("does not call setThoughtLevel when the role has no thought level", async () => {
    const store = await createStore();
    const project = await store.createProject("No thought");
    await store.setLocalPath(project.projectId, process.cwd());
    const room = await store.getRoom(project.projectId);
    const dev = room.members.find((m) => m.templateId === "role_developer")!;

    const setThoughtLevel = vi.fn(async () => undefined);
    const conductor = new ImConductor(
      store,
      () => undefined,
      vi.fn(async () => undefined),
      vi.fn(async () => undefined),
      undefined,
      undefined,
      setThoughtLevel
    );

    await conductor.postMessage({
      projectId: project.projectId,
      body: "Write code",
      quoteIds: [],
      mentionRoleIds: [dev.memberId]
    });

    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(setThoughtLevel).not.toHaveBeenCalled();
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

  it("persists in-flight role replies so a restarted store can load them", async () => {
    const store = await createStore();
    const project = await store.createProject("Restart mid-stream");
    const room = await store.getRoom(project.projectId);
    const pm = room.members.find((member) => member.templateId === "role_product_manager")!;
    const conductor = new ImConductor(store, () => undefined, vi.fn(async () => undefined), vi.fn(async () => undefined));

    const job = await store.createJob({
      projectId: project.projectId,
      memberId: pm.memberId,
      messageId: null,
      brief: { persona: pm.persona, instruction: "plan", cwd: process.cwd(), quotes: [], knowledge: [] },
      status: "running"
    });
    await store.updateJob(job.jobId, { acpChatId: "chat-restart-stream" });

    await conductor.handleAcpStream({
      type: "assistantDelta",
      chatId: "chat-restart-stream",
      id: "delta-1",
      text: "Please implement the following fixes.",
      thinking: "Drafting the repair plan...",
      streaming: true,
      toolCalls: []
    });

    const liveMessages = await store.listMessages(project.projectId);
    expect(liveMessages).toHaveLength(1);
    expect(liveMessages[0]?.kind).toBe("role.say");
    expect(liveMessages[0]?.jobId).toBe(job.jobId);
    expect(liveMessages[0]?.body).toBe("Please implement the following fixes.");
    expect(liveMessages[0]?.thinking).toBe("Drafting the repair plan...");

    const restarted = new ImStore(desktopDbPath(homes[homes.length - 1]!));
    await restarted.initialize();
    const recovered = await restarted.listMessages(project.projectId);
    expect(recovered).toHaveLength(1);
    expect(recovered[0]?.body).toBe("Please implement the following fixes.");
    expect(recovered[0]?.thinking).toBe("Drafting the repair plan...");
    expect((await restarted.getJob(job.jobId))?.status).toBe("cancelled");
  });

  it("resumes an interrupted job from the saved draft", async () => {
    const store = await createStore();
    const project = await store.createProject("Resume mid-stream");
    await store.setLocalPath(project.projectId, process.cwd());
    const room = await store.getRoom(project.projectId);
    const pm = room.members.find((member) => member.templateId === "role_product_manager")!;
    const connect = vi.fn(async () => undefined);
    const prompt = vi.fn(async () => undefined);
    const conductor = new ImConductor(store, () => undefined, connect, prompt);

    const job = await store.createJob({
      projectId: project.projectId,
      memberId: pm.memberId,
      messageId: null,
      brief: { persona: pm.persona, instruction: "Write the full plan", cwd: process.cwd(), quotes: [], knowledge: [] },
      status: "running"
    });
    await store.updateJob(job.jobId, { acpChatId: "chat-resume-stream" });
    await conductor.handleAcpStream({
      type: "assistantDelta",
      chatId: "chat-resume-stream",
      id: "delta-1",
      text: "Step 1 is done.",
      streaming: true,
      toolCalls: []
    });
    await store.updateJob(job.jobId, {
      status: "cancelled",
      error: "App restarted while job was running",
      finished: true
    });

    const resumed = await conductor.resumeJob(job.jobId);
    expect(resumed.job.jobId).not.toBe(job.jobId);
    expect(resumed.job.status === "queued" || resumed.job.status === "connecting" || resumed.job.status === "running").toBe(true);
    expect(resumed.job.brief.instruction).toContain("Write the full plan");
    expect(resumed.job.brief.instruction).toContain("Interrupted previous attempt");
    expect(resumed.job.brief.instruction).toContain("Step 1 is done.");
    await vi.waitFor(() => expect(prompt).toHaveBeenCalled(), { timeout: 3000 });
  });

  it("passes image attachments to ACP agent prompt when message contains images", async () => {
    const store = await createStore();
    const project = await store.createProject("Image prompt test");
    await store.setLocalPath(project.projectId, process.cwd());
    const room = await store.getRoom(project.projectId);
    const pm = room.members.find((member) => member.templateId === "role_product_manager")!;
    const connect = vi.fn(async () => undefined);
    const prompt = vi.fn(async () => undefined);
    const conductor = new ImConductor(store, () => undefined, connect, prompt);

    await conductor.postMessage({
      projectId: project.projectId,
      body: "Analyze this diagram",
      quoteIds: [],
      mentionRoleIds: [pm.memberId],
      images: [
        {
          fileName: "diagram.png",
          mimeType: "image/png",
          data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
        }
      ]
    });

    await vi.waitFor(() => expect(prompt).toHaveBeenCalled(), { timeout: 3000 });
    expect(connect).toHaveBeenCalled();
    expect(prompt).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining("Analyze this diagram"),
      expect.arrayContaining([
        expect.objectContaining({
          fileName: "diagram.png",
          mimeType: "image/png"
        })
      ])
    );
  });

  it("captures modified files from tool calls with locations or rawInput across stream events", async () => {
    const store = await createStore();
    const project = await store.createProject("Tool file capture test");
    const room = await store.getRoom(project.projectId);
    const dev = room.members.find((member) => member.templateId === "role_developer")!;
    const conductor = new ImConductor(store, () => undefined, vi.fn(async () => undefined), vi.fn(async () => undefined));

    const job = await store.createJob({
      projectId: project.projectId,
      memberId: dev.memberId,
      messageId: null,
      brief: { persona: dev.persona, instruction: "code", cwd: process.cwd(), quotes: [], knowledge: [] },
      status: "running"
    });
    await store.updateJob(job.jobId, { acpChatId: "chat-tool-1" });

    // Step 1: Delta with edit tool call using locations
    await conductor.handleAcpStream({
      type: "assistantDelta",
      chatId: "chat-tool-1",
      id: "delta-1",
      text: "Editing components...",
      streaming: true,
      toolCalls: [
        {
          toolCallId: "t1",
          kind: "edit",
          status: "completed",
          locations: [{ path: "src/components/Button.tsx" }]
        }
      ]
    });

    let currentJob = await store.getJob(job.jobId);
    expect(currentJob?.filesChanged).toEqual(["src/components/Button.tsx"]);

    // Step 2: Delta with write tool call using rawInput file_path
    await conductor.handleAcpStream({
      type: "assistantDelta",
      chatId: "chat-tool-1",
      id: "delta-2",
      text: "Writing tests...",
      streaming: true,
      toolCalls: [
        {
          toolCallId: "t2",
          title: "Write file Button.test.tsx",
          status: "completed",
          rawInput: { file_path: "src/components/Button.test.tsx" }
        }
      ]
    });

    currentJob = await store.getJob(job.jobId);
    expect(currentJob?.filesChanged).toEqual([
      "src/components/Button.tsx",
      "src/components/Button.test.tsx"
    ]);

    // Step 3: Done with tool calls
    await conductor.handleAcpStream({
      type: "assistantDone",
      chatId: "chat-tool-1",
      streaming: false,
      message: {
        id: "msg-done",
        role: "assistant",
        text: "Finished editing files.",
        timestamp: Date.now(),
        toolCalls: [
          {
            toolCallId: "t1",
            kind: "edit",
            status: "completed",
            locations: [{ path: "src/components/Button.tsx" }]
          },
          {
            toolCallId: "t2",
            title: "Write file Button.test.tsx",
            status: "completed",
            rawInput: { file_path: "src/components/Button.test.tsx" }
          }
        ]
      }
    });

    currentJob = await store.getJob(job.jobId);
    expect(currentJob?.filesChanged).toEqual([
      "src/components/Button.tsx",
      "src/components/Button.test.tsx"
    ]);
  });

  it("parses dispatch blocks from assistant output", () => {
    const text = `Here is my architecture plan:
1. Setup DB
2. Build UI

<im_dispatch target="role_developer" reason="Need backend CRUD implementation">
Please implement the user model and DB migration.
</im_dispatch>

<im_dispatch target="DevOps Engineer">
Setup Docker compose for postgres.
</im_dispatch>`;

    const blocks = parseDispatchBlocks(text);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.target).toBe("role_developer");
    expect(blocks[0]?.reason).toBe("Need backend CRUD implementation");
    expect(blocks[0]?.instruction).toBe("Please implement the user model and DB migration.");
    expect(blocks[1]?.target).toBe("DevOps Engineer");
    expect(blocks[1]?.reason).toBeUndefined();
    expect(blocks[1]?.instruction).toBe("Setup Docker compose for postgres.");
  });

  it("resolves dispatch target with exact ID, case-insensitive name, and alias with security check", () => {
    const members = [
      {
        memberId: "m-dev",
        projectId: "p1",
        templateId: "role_developer",
        name: "Developer",
        persona: "",
        agent: "claude" as const,
        permissions: "write" as const,
        tools: { fsRead: true, fsWrite: true, execute: true },
        enabled: true,
        acpChatId: null,
        createdAtMs: 1,
        updatedAtMs: 1
      },
      {
        memberId: "m-devops",
        projectId: "p1",
        templateId: "tpl_devops_123",
        name: "DevOps Engineer",
        persona: "",
        agent: "pi" as const,
        permissions: "write" as const,
        tools: { fsRead: true, fsWrite: true, execute: true },
        enabled: true,
        acpChatId: null,
        createdAtMs: 1,
        updatedAtMs: 1
      }
    ];

    // Allowed callees includes dev and devops
    const allowed = ["role_developer", "tpl_devops_123"];

    // Exact match
    expect(resolveDispatchTarget("role_developer", allowed, members)?.memberId).toBe("m-dev");
    // Name match
    expect(resolveDispatchTarget("DevOps Engineer", allowed, members)?.memberId).toBe("m-devops");
    // Case-insensitive alias match
    expect(resolveDispatchTarget("developer", allowed, members)?.memberId).toBe("m-dev");

    // Security check: if not in allowed list, rejected
    expect(resolveDispatchTarget("role_developer", ["tpl_devops_123"], members)).toBeUndefined();
  });

  it("auto-dispatches task when role has autoDispatch enabled and detects loops", async () => {
    const store = await createStore();
    const project = await store.createProject("Auto Dispatch Test");
    await store.setLocalPath(project.projectId, process.cwd());

    // Enable autoDispatch on Architect
    await store.updateTemplate({
      templateId: "role_architect",
      autoDispatch: true,
      callableTemplateIds: ["role_developer"]
    });

    const room = await store.getRoom(project.projectId);
    const architect = room.members.find((m) => m.templateId === "role_architect")!;
    const developer = room.members.find((m) => m.templateId === "role_developer")!;

    const job = await store.createJob({
      projectId: project.projectId,
      memberId: architect.memberId,
      messageId: null,
      brief: { persona: architect.persona, instruction: "design", cwd: process.cwd(), quotes: [], knowledge: [] },
      status: "running"
    });
    await store.updateJob(job.jobId, { acpChatId: "chat-arch-auto" });

    const conductor = new ImConductor(store, () => undefined, vi.fn(async () => undefined), vi.fn(async () => undefined));

    // Simulate assistant finishing with delegation tag
    await conductor.handleAcpStream({
      type: "assistantDone",
      chatId: "chat-arch-auto",
      streaming: false,
      message: {
        id: "msg-arch-done",
        role: "assistant",
        text: `Design is complete.
<im_dispatch target="role_developer" reason="Ready for code implementation">
Implement the search indexing algorithm as designed.
</im_dispatch>`,
        timestamp: Date.now()
      }
    });

    // Verify developer job was automatically created and queued/dispatched
    const updatedRoom = await store.getRoom(project.projectId);
    const devJob = updatedRoom.jobs.find((j) => j.memberId === developer.memberId);
    expect(devJob).toBeTruthy();
    expect(devJob?.brief.instruction).toBe("Implement the search indexing algorithm as designed.");
    expect(devJob?.brief.dispatchChain).toEqual(["role_architect", "role_developer"]);

    const archMsg = (await store.listMessages(project.projectId)).find((m) => m.jobId === job.jobId);
    expect(archMsg?.delegationProposals).toHaveLength(1);
    expect(archMsg?.delegationProposals?.[0]?.status).toBe("auto_dispatched");
    expect(archMsg?.delegationProposals?.[0]?.dispatchedJobId).toBe(devJob?.jobId);
  });

  it("supports manual dispatchProposal and dismissProposal", async () => {
    const store = await createStore();
    const project = await store.createProject("Manual Proposal Test");
    await store.setLocalPath(project.projectId, process.cwd());

    const room = await store.getRoom(project.projectId);
    const architect = room.members.find((m) => m.templateId === "role_architect")!;
    const developer = room.members.find((m) => m.templateId === "role_developer")!;

    const msg = await store.insertMessage({
      projectId: project.projectId,
      kind: "role.say",
      authorMemberId: architect.memberId,
      authorLabel: architect.name,
      body: "Design finished.",
      delegationProposals: [
        {
          id: "prop-1",
          targetTemplateId: "role_developer",
          targetRoleName: "Developer",
          instruction: "Write the backend service.",
          reason: "Need service",
          status: "pending",
          createdAtMs: Date.now()
        },
        {
          id: "prop-2",
          targetTemplateId: "role_tester",
          targetRoleName: "Tester",
          instruction: "Test edge cases.",
          status: "pending",
          createdAtMs: Date.now()
        }
      ]
    });

    const conductor = new ImConductor(store, () => undefined, vi.fn(async () => undefined), vi.fn(async () => undefined));

    // Dispatch proposal 1
    const { message: afterDispatch, job } = await conductor.dispatchProposal({
      projectId: project.projectId,
      messageId: msg.messageId,
      proposalId: "prop-1"
    });

    expect(job).toBeTruthy();
    expect(job.memberId).toBe(developer.memberId);
    expect(job.brief.instruction).toBe("Write the backend service.");
    expect(afterDispatch.delegationProposals?.find((p) => p.id === "prop-1")?.status).toBe("dispatched");

    // Dismiss proposal 2
    const afterDismiss = await conductor.dismissProposal({
      projectId: project.projectId,
      messageId: msg.messageId,
      proposalId: "prop-2"
    });
    expect(afterDismiss.delegationProposals?.find((p) => p.id === "prop-2")?.status).toBe("dismissed");
  });

  it("records unmatched tip when no-mention message is sent with filler text", async () => {
    const store = await createStore();
    const project = await store.createProject("Unmatched Tip Test");
    await store.setLocalPath(project.projectId, process.cwd());

    const emit = vi.fn();
    const conductor = new ImConductor(store, emit, vi.fn(async () => undefined), vi.fn(async () => undefined));

    const result = await conductor.postMessage({
      projectId: project.projectId,
      body: "好的",
      quoteIds: [],
      mentionRoleIds: []
    });

    expect(result.job).toBeNull();
    // Non-blocking: intent routing runs in background and updates via messageUpdate
    await new Promise((resolve) => setTimeout(resolve, 50));
    const msg = await store.getMessage(result.message.messageId);
    expect(msg?.routingTip).toBe("desktop.im.routingUnmatchedTip");
    expect(msg?.routingTimedOut).toBeUndefined();
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ type: "messageUpdate" }));
  });

  it("reuses one ACP session per role and sends incremental prompts after bootstrap", async () => {
    const store = await createStore();
    const project = await store.createProject("Reuse session");
    await store.setLocalPath(project.projectId, process.cwd());
    const room = await store.getRoom(project.projectId);
    const pm = room.members.find((member) => member.templateId === "role_product_manager")!;
    const connect = vi.fn(async () => undefined);
    const prompt = vi.fn(async (_chatId: string, _text: string, _images?: any) => undefined);
    const conductor = new ImConductor(store, () => undefined, connect, prompt);
    const createdBefore = (createAcpRecord as ReturnType<typeof vi.fn>).mock.calls.length;

    await conductor.postMessage({
      projectId: project.projectId,
      body: "first question",
      quoteIds: [],
      mentionRoleIds: [pm.memberId]
    });
    await vi.waitFor(() => expect(prompt).toHaveBeenCalledTimes(1));
    expect(prompt.mock.calls[0]?.[1]).toContain("[Role persona]");
    expect(createAcpRecord).toHaveBeenCalledTimes(createdBefore + 1);
    expect(createAcpRecord).toHaveBeenLastCalledWith(expect.any(String), expect.any(String), expect.any(String), { source: "im" });

    await conductor.postMessage({
      projectId: project.projectId,
      body: "second question",
      quoteIds: [],
      mentionRoleIds: [pm.memberId]
    });
    await vi.waitFor(() => expect(prompt).toHaveBeenCalledTimes(2));
    expect(prompt.mock.calls[1]?.[1]).toBe("second question");
    expect(prompt.mock.calls[1]?.[1]).not.toContain("[Role persona]");
    expect(createAcpRecord).toHaveBeenCalledTimes(createdBefore + 1);
  });

  it("follow-up reuses the same ACP session and sends only the new question", async () => {
    const store = await createStore();
    const project = await store.createProject("Follow up");
    await store.setLocalPath(project.projectId, process.cwd());
    const room = await store.getRoom(project.projectId);
    const pm = room.members.find((member) => member.templateId === "role_product_manager")!;
    const connect = vi.fn(async () => undefined);
    const prompt = vi.fn(async (_chatId: string, _text: string, _images?: any) => undefined);
    const conductor = new ImConductor(store, () => undefined, connect, prompt);
    const createdBefore = (createAcpRecord as ReturnType<typeof vi.fn>).mock.calls.length;

    const first = await conductor.postMessage({
      projectId: project.projectId,
      body: "plan this",
      quoteIds: [],
      mentionRoleIds: [pm.memberId]
    });
    await vi.waitFor(() => expect(prompt).toHaveBeenCalledTimes(1));
    const reply = await store.insertMessage({
      projectId: project.projectId,
      kind: "role.say",
      authorMemberId: pm.memberId,
      authorLabel: pm.name,
      body: "Here is the plan",
      jobId: first.job?.jobId,
      threadId: first.job?.threadId || first.message.threadId
    });

    const follow = await conductor.postMessage({
      projectId: project.projectId,
      body: "add more detail",
      quoteIds: [],
      mentionRoleIds: [],
      followUpToMessageId: reply.messageId
    });
    await vi.waitFor(() => expect(prompt).toHaveBeenCalledTimes(2));
    expect(follow.message.mentionRoleIds).toEqual([pm.memberId]);
    expect(follow.message.threadId).toBe(reply.threadId);
    expect(prompt.mock.calls[1]?.[1]).toBe("add more detail");
    expect(createAcpRecord).toHaveBeenCalledTimes(createdBefore + 1);
  });

  it("resumes an interrupted job on the existing ACP session without a bootstrap prompt", async () => {
    const store = await createStore();
    const project = await store.createProject("Resume incremental");
    await store.setLocalPath(project.projectId, process.cwd());
    const room = await store.getRoom(project.projectId);
    const pm = room.members.find((member) => member.templateId === "role_product_manager")!;
    const connect = vi.fn(async () => undefined);
    const prompt = vi.fn(async (_chatId: string, _text: string, _images?: any) => undefined);
    const conductor = new ImConductor(store, () => undefined, connect, prompt);
    const createdBefore = (createAcpRecord as ReturnType<typeof vi.fn>).mock.calls.length;

    const job = await store.createJob({
      projectId: project.projectId,
      memberId: pm.memberId,
      messageId: null,
      brief: { persona: pm.persona, instruction: "Write the full plan", cwd: process.cwd(), quotes: [], knowledge: [] },
      status: "cancelled",
      threadId: "thread-resume"
    });
    await store.updateJob(job.jobId, { acpChatId: "chat-resume-live", finished: true });
    await store.insertMessage({
      projectId: project.projectId,
      kind: "role.say",
      authorMemberId: pm.memberId,
      authorLabel: pm.name,
      body: "Step 1 is done.",
      jobId: job.jobId,
      threadId: "thread-resume"
    });

    const resumed = await conductor.resumeJob(job.jobId);
    expect(resumed.job.threadId).toBe("thread-resume");
    await vi.waitFor(() => expect(prompt).toHaveBeenCalled(), { timeout: 3000 });
    expect(prompt.mock.calls[0]?.[1]).toContain("Interrupted previous attempt");
    expect(prompt.mock.calls[0]?.[1]).not.toContain("[Role persona]");
    expect(createAcpRecord).toHaveBeenCalledTimes(createdBefore);
  });

  it("falls back to a full brief when a reused ACP session is rebuilt", async () => {
    const store = await createStore();
    const project = await store.createProject("Rebuilt session");
    await store.setLocalPath(project.projectId, process.cwd());
    const room = await store.getRoom(project.projectId);
    const pm = room.members.find((member) => member.templateId === "role_product_manager")!;
    await store.setMemberAcpChatId(pm.memberId, "chat-rebuilt");
    const connect = vi.fn(async () => ({ rebuilt: true }));
    const prompt = vi.fn(async (_chatId: string, _text: string, _images?: any) => undefined);
    const conductor = new ImConductor(store, () => undefined, connect, prompt);

    await conductor.postMessage({
      projectId: project.projectId,
      body: "continue after crash",
      quoteIds: [],
      mentionRoleIds: [pm.memberId]
    });
    await vi.waitFor(() => expect(prompt).toHaveBeenCalled());
    expect(prompt.mock.calls[0]?.[1]).toContain("[Role persona]");
    const messages = await store.listMessages(project.projectId);
    expect(messages.some((item) => item.kind === "system" && item.body === "desktop.im.sessionRebuilt")).toBe(true);
  });

  it("cancels an active job, flushes streaming message with streaming: false, and triggers cancelChat", async () => {
    const store = await createStore();
    const project = await store.createProject("Cancel job test");
    await store.setLocalPath(project.projectId, process.cwd());
    const room = await store.getRoom(project.projectId);
    const pm = room.members.find((member) => member.templateId === "role_product_manager")!;
    const connect = vi.fn(async () => undefined);
    const prompt = vi.fn(async () => undefined);
    const cancelChat = vi.fn(async () => undefined);
    const emitted: any[] = [];
    const conductor = new ImConductor(
      store,
      (event) => emitted.push(event),
      connect,
      prompt,
      undefined,
      undefined,
      undefined,
      cancelChat
    );

    const job = await store.createJob({
      projectId: project.projectId,
      memberId: pm.memberId,
      messageId: null,
      brief: { persona: pm.persona, instruction: "Long task", cwd: process.cwd(), quotes: [], knowledge: [] },
      status: "running"
    });
    await store.updateJob(job.jobId, { acpChatId: "chat-cancel-test" });

    await conductor.handleAcpStream({
      type: "assistantDelta",
      chatId: "chat-cancel-test",
      id: "delta-1",
      text: "Streaming in progress...",
      streaming: true,
      toolCalls: []
    });

    const cancelledJob = await conductor.cancelJob(job.jobId);
    expect(cancelledJob.status).toBe("cancelled");
    expect(cancelChat).toHaveBeenCalledWith("chat-cancel-test");

    const messageUpdate = emitted.find((e) => e.type === "messageUpdate" && e.message.streaming === false);
    expect(messageUpdate).toBeTruthy();
    expect(messageUpdate.message.body).toBe("Streaming in progress...");

    const savedMessages = await store.listMessages(project.projectId);
    expect(savedMessages).toHaveLength(1);
    expect(savedMessages[0]?.body).toBe("Streaming in progress...");

    const savedJob = await store.getJob(job.jobId);
    expect(savedJob?.status).toBe("cancelled");
  });

  it("revives an interrupted job when ACP is still streaming", async () => {
    const store = await createStore();
    const project = await store.createProject("Revive stream");
    const room = await store.getRoom(project.projectId);
    const pm = room.members.find((member) => member.templateId === "role_product_manager")!;
    const emit = vi.fn();
    const conductor = new ImConductor(store, emit, vi.fn(async () => undefined), vi.fn(async () => undefined));
    const job = await store.createJob({
      projectId: project.projectId,
      memberId: pm.memberId,
      messageId: null,
      brief: { persona: pm.persona, instruction: "plan", cwd: process.cwd(), quotes: [], knowledge: [] },
      status: "cancelled"
    });
    await store.updateJob(job.jobId, {
      acpChatId: "chat-revive",
      error: "App restarted while job was running",
      finished: true
    });

    await conductor.handleAcpStream({
      type: "assistantDelta",
      chatId: "chat-revive",
      id: "delta-1",
      text: "Still working on it.",
      streaming: true,
      toolCalls: []
    });

    const revived = await store.getJob(job.jobId);
    expect(revived?.status).toBe("running");
    expect(revived?.finishedAtMs).toBeNull();
    const messages = await store.listMessages(project.projectId);
    expect(messages.some((item) => item.body === "Still working on it.")).toBe(true);
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ type: "job", job: expect.objectContaining({ status: "running" }) }));
  });

  it("waits for a live ACP turn to finish before sending the next prompt", async () => {
    const store = await createStore();
    const project = await store.createProject("Wait idle");
    await store.setLocalPath(project.projectId, process.cwd());
    const room = await store.getRoom(project.projectId);
    const pm = room.members.find((member) => member.templateId === "role_product_manager")!;
    await store.setMemberAcpChatId(pm.memberId, "chat-busy");
    let running = true;
    const inspect = vi.fn(() => ({ live: true, running }));
    const prompt = vi.fn(async () => undefined);
    const conductor = new ImConductor(
      store,
      () => undefined,
      vi.fn(async () => undefined),
      prompt,
      undefined,
      undefined,
      undefined,
      undefined,
      inspect
    );
    const pending = conductor.postMessage({
      projectId: project.projectId,
      body: "next question",
      quoteIds: [],
      mentionRoleIds: [pm.memberId]
    });
    await vi.waitFor(() => expect(inspect).toHaveBeenCalled());
    expect(prompt).not.toHaveBeenCalled();
    running = false;
    await pending;
    await vi.waitFor(() => expect(prompt).toHaveBeenCalled());
    expect(prompt.mock.calls[0]?.[1]).toContain("next question");
  });
});
