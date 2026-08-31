import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { desktopDbPath, ensureDesktopDbSchema } from "@agent-resume/core";
import { buildDispatchPrompt, fillSelectionPrompt, ImStore } from "./store";

const homes: string[] = [];

async function createStoreWithHome(): Promise<{ store: ImStore; panelHome: string }> {
  const panelHome = await fs.mkdtemp(path.join(os.tmpdir(), "agent-resume-im-"));
  homes.push(panelHome);
  const dbPath = desktopDbPath(panelHome);
  await fs.mkdir(path.dirname(dbPath), { recursive: true });
  await ensureDesktopDbSchema(dbPath);
  const store = new ImStore(dbPath);
  await store.initialize();
  return { store, panelHome };
}

async function createStore(): Promise<ImStore> {
  return (await createStoreWithHome()).store;
}

afterEach(async () => {
  await Promise.all(homes.splice(0).map((home) => fs.rm(home, { recursive: true, force: true })));
});

describe("ImStore", () => {
  it("creates a user-owned project with the six builtin roles", async () => {
    const store = await createStore();
    const project = await store.createProject("Room One");
    const room = await store.getRoom(project.projectId);
    expect(project.localPath).toBeNull();
    expect(room.members.map((member) => member.templateId)).toEqual([
      "role_product_manager",
      "role_architect",
      "role_project_manager",
      "role_ui_designer",
      "role_developer",
      "role_tester"
    ]);
    expect(room.members.every((member) => member.agent === "claude")).toBe(true);
  });

  it("backfills missing builtin roles without duplicating Developer", async () => {
    const store = await createStore();
    const templates = await store.listTemplates();
    expect(templates.map((template) => template.templateId)).toEqual([
      "role_product_manager",
      "role_architect",
      "role_project_manager",
      "role_ui_designer",
      "role_developer",
      "role_tester"
    ]);
    await store.initialize();
    const again = await store.listTemplates();
    expect(again).toHaveLength(6);
  });

  it("seeds builtin selection actions and blocks deleting them", async () => {
    const store = await createStore();
    const actions = await store.listSelectionActions();
    expect(actions.map((item) => item.actionId)).toEqual(["quote", "translate", "explain"]);
    expect(actions[0]?.kind).toBe("context");
    expect(actions[1]?.kind).toBe("independent");
    await expect(store.deleteSelectionAction("quote")).rejects.toThrow(/cannot be deleted/i);
    const custom = await store.createSelectionAction({
      name: "Summarize",
      kind: "independent",
      prompt: "Summarize:\n{selection}",
      providerId: "p1",
      modelId: "m1"
    });
    expect(custom.providerId).toBe("p1");
    expect(custom.modelId).toBe("m1");
    expect(fillSelectionPrompt(custom.prompt, "hello world")).toContain("hello world");
    const updated = await store.updateSelectionAction({
      actionId: custom.actionId,
      providerId: "p2",
      modelId: "m2"
    });
    expect(updated.providerId).toBe("p2");
    expect(updated.modelId).toBe("m2");
    await store.deleteSelectionAction(custom.actionId);
    expect((await store.listSelectionActions()).map((item) => item.actionId)).toEqual(["quote", "translate", "explain"]);
  });

  it("treats write and execute roles as exclusive", async () => {
    const store = await createStore();
    const project = await store.createProject("Locks");
    const room = await store.getRoom(project.projectId);
    const developer = room.members.find((member) => member.templateId === "role_developer")!;
    const tester = room.members.find((member) => member.templateId === "role_tester")!;
    const pm = room.members.find((member) => member.templateId === "role_product_manager")!;
    const architect = room.members.find((member) => member.templateId === "role_architect")!;
    expect(store.memberNeedsExclusiveLock(developer)).toBe(true);
    expect(store.memberNeedsExclusiveLock(tester)).toBe(true);
    expect(store.memberNeedsExclusiveLock(pm)).toBe(false);
    expect(store.memberNeedsExclusiveLock(architect)).toBe(false);
  });

  it("does not revive a builtin role removed from a fully seeded room", async () => {
    const store = await createStore();
    const project = await store.createProject("Keep custom set");
    const room = await store.getRoom(project.projectId);
    const tester = room.members.find((member) => member.templateId === "role_tester");
    expect(tester).toBeTruthy();
    await store.removeMember(tester!.memberId);
    await store.initialize();
    const after = await store.getRoom(project.projectId);
    expect(after.members.some((member) => member.templateId === "role_tester")).toBe(false);
    expect(after.members).toHaveLength(5);
  });

  it("adds a custom template only when a room enables it", async () => {
    const store = await createStore();
    const first = await store.createProject("Alpha");
    const second = await store.createProject("Beta");
    const template = await store.createTemplate({
      name: "Docs",
      persona: "Write docs.",
      agent: "pi",
      tools: { fsRead: true, fsWrite: false, execute: false }
    });
    await store.addMember(first.projectId, template.templateId);
    const alpha = await store.getRoom(first.projectId);
    const beta = await store.getRoom(second.projectId);
    expect(alpha.members.some((member) => member.name === "Docs")).toBe(true);
    expect(beta.members.some((member) => member.name === "Docs")).toBe(false);
  });

  it("snapshots room knowledge into the dispatch prompt", async () => {
    const store = await createStore();
    const project = await store.createProject("Knowledge");
    await store.addKnowledgeText(project.projectId, "Auth", "Use the existing helper.");
    await store.addKnowledgeLink(project.projectId, "https://example.com/docs", "Docs");
    const room = await store.getRoom(project.projectId);
    const prompt = buildDispatchPrompt({
      persona: "You are Developer.",
      instruction: "Implement login.",
      cwd: "/tmp/app",
      quotes: [],
      knowledge: store.snapshotKnowledge(room.knowledge)
    });
    expect(prompt).toContain("[Background knowledge]");
    expect(prompt).toContain("Use the existing helper.");
    expect(prompt).toContain("https://example.com/docs");
    expect(prompt).toContain("fetch the page yourself");
    expect(prompt).toContain("You may list and read the entire tree");
  });

  it("rejects non-http knowledge links", async () => {
    const store = await createStore();
    const project = await store.createProject("Bad link");
    await expect(store.addKnowledgeLink(project.projectId, "file:///tmp/secret")).rejects.toThrow(/http/i);
  });

  it("uses the live template prompt after an update", async () => {
    const store = await createStore();
    const updated = await store.updateTemplate({
      templateId: "role_developer",
      persona: "Ship small diffs only."
    });
    expect(updated.persona).toBe("Ship small diffs only.");
    const project = await store.createProject("Live prompt");
    const room = await store.getRoom(project.projectId);
    const developer = room.members.find((member) => member.templateId === "role_developer");
    expect(developer?.persona).toBe("Ship small diffs only.");
  });

  it("persists thought level on role templates and propagates to room members", async () => {
    const store = await createStore();
    const created = await store.createTemplate({
      name: "Architect",
      persona: "You are Lead Architect.",
      agent: "codex",
      thoughtLevel: "high"
    });
    expect(created.thoughtLevel).toBe("high");

    const project = await store.createProject("Thought Test");
    await store.addMember(project.projectId, created.templateId);
    let room = await store.getRoom(project.projectId);
    let architect = room.members.find((member) => member.templateId === created.templateId);
    expect(architect?.thoughtLevel).toBe("high");

    const updated = await store.updateTemplate({
      templateId: created.templateId,
      thoughtLevel: "low"
    });
    expect(updated.thoughtLevel).toBe("low");

    room = await store.getRoom(project.projectId);
    architect = room.members.find((member) => member.templateId === created.templateId);
    expect(architect?.thoughtLevel).toBe("low");

    const cleared = await store.updateTemplate({
      templateId: created.templateId,
      thoughtLevel: ""
    });
    expect(cleared.thoughtLevel).toBeUndefined();

    room = await store.getRoom(project.projectId);
    architect = room.members.find((member) => member.templateId === created.templateId);
    expect(architect?.thoughtLevel).toBeUndefined();
  });

  it("persists model configuration on role templates and propagates to room members", async () => {
    const store = await createStore();
    const created = await store.createTemplate({
      name: "Architect",
      persona: "You are Lead Architect.",
      agent: "claude",
      model: "claude-opus"
    });
    expect(created.model).toBe("claude-opus");

    const project = await store.createProject("Model Test");
    await store.addMember(project.projectId, created.templateId);
    let room = await store.getRoom(project.projectId);
    let architect = room.members.find((member) => member.templateId === created.templateId);
    expect(architect?.model).toBe("claude-opus");

    const updated = await store.updateTemplate({
      templateId: created.templateId,
      model: "claude-3-7-sonnet-20250219"
    });
    expect(updated.model).toBe("claude-3-7-sonnet-20250219");

    room = await store.getRoom(project.projectId);
    architect = room.members.find((member) => member.templateId === created.templateId);
    expect(architect?.model).toBe("claude-3-7-sonnet-20250219");

    const cleared = await store.updateTemplate({
      templateId: created.templateId,
      model: ""
    });
    expect(cleared.model).toBeUndefined();

    room = await store.getRoom(project.projectId);
    architect = room.members.find((member) => member.templateId === created.templateId);
    expect(architect?.model).toBeUndefined();
  });

  it("reconciles stale running/queued jobs on store initialization after restart", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "im-store-restart-"));
    try {
      const dbPath = path.join(dir, "desktop.db");
      const firstStore = new ImStore(dbPath);
      await firstStore.initialize();

      const project = await firstStore.createProject("Restart Test");
      const room = await firstStore.getRoom(project.projectId);
      const dev = room.members.find((m) => m.templateId === "role_developer")!;

      const job1 = await firstStore.createJob({
        projectId: project.projectId,
        memberId: dev.memberId,
        messageId: null,
        brief: { persona: "", instruction: "", cwd: "/tmp", quotes: [], knowledge: [] },
        status: "running"
      });
      const job2 = await firstStore.createJob({
        projectId: project.projectId,
        memberId: dev.memberId,
        messageId: null,
        brief: { persona: "", instruction: "", cwd: "/tmp", quotes: [], knowledge: [] },
        status: "queued"
      });

      expect((await firstStore.getJob(job1.jobId))?.status).toBe("running");
      expect((await firstStore.getJob(job2.jobId))?.status).toBe("queued");

      // Simulate app restart: open new store instance on the same db
      const restartedStore = new ImStore(dbPath);
      await restartedStore.initialize();

      const recoveredJob1 = await restartedStore.getJob(job1.jobId);
      const recoveredJob2 = await restartedStore.getJob(job2.jobId);

      expect(recoveredJob1?.status).toBe("cancelled");
      expect(recoveredJob1?.error).toContain("App restarted");
      expect(recoveredJob2?.status).toBe("cancelled");
      expect(recoveredJob2?.error).toContain("App restarted");

      // Verify no active writer jobs remain to block the queue
      const activeWriter = await restartedStore.findActiveWriterJob(project.projectId);
      expect(activeWriter).toBeUndefined();
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("allows cancelling active jobs via cancelJob", async () => {
    const store = await createStore();
    const project = await store.createProject("Cancel Test");
    const room = await store.getRoom(project.projectId);
    const dev = room.members.find((m) => m.templateId === "role_developer")!;

    const job = await store.createJob({
      projectId: project.projectId,
      memberId: dev.memberId,
      messageId: null,
      brief: { persona: "", instruction: "", cwd: "/tmp", quotes: [], knowledge: [] },
      status: "running"
    });

    const cancelled = await store.cancelJob(job.jobId);
    expect(cancelled.status).toBe("cancelled");
    expect((await store.getJob(job.jobId))?.status).toBe("cancelled");
  });

  it("persists and loads message image attachments and thinking", async () => {
    const store = await createStore();
    const project = await store.createProject("Image Msg Test");

    const message = await store.insertMessage({
      projectId: project.projectId,
      kind: "human",
      authorLabel: "You",
      body: "Look at this mockup",
      thinking: "Thinking about design...",
      images: [
        {
          id: "img-1",
          fileName: "mockup.png",
          mimeType: "image/png",
          storagePath: ".desktop/im/img.png",
          previewUrl: "data:image/png;base64,AAAA"
        }
      ]
    });

    expect(message.images).toHaveLength(1);
    expect(message.images?.[0]?.fileName).toBe("mockup.png");
    expect(message.thinking).toBe("Thinking about design...");

    const loaded = await store.getMessage(message.messageId);
    expect(loaded?.images).toHaveLength(1);
    expect(loaded?.images?.[0]?.fileName).toBe("mockup.png");
    expect(loaded?.thinking).toBe("Thinking about design...");
  });

  it("creates a scratch folder when panel home is provided without a local path", async () => {
    const { store, panelHome } = await createStoreWithHome();
    const project = await store.createProject("Scratch chat", panelHome);
    expect(project.localPath).toBe(path.join(panelHome, ".desktop", "scratch", "im", project.projectId));
    const stat = await fs.stat(project.localPath!);
    expect(stat.isDirectory()).toBe(true);
  });

  it("assigns a scratch folder to chats that still have no local path", async () => {
    const { store, panelHome } = await createStoreWithHome();
    const project = await store.createProject("Legacy chat");
    expect(project.localPath).toBeNull();
    const cwd = await store.ensureProjectLocalPath(project.projectId, panelHome);
    expect(cwd).toBe(path.join(panelHome, ".desktop", "scratch", "im", project.projectId));
    expect((await store.getProject(project.projectId))?.localPath).toBe(cwd);
  });

  it("deletes associated ACP chat ids, scratch dir, and attachments", async () => {
    const { store, panelHome } = await createStoreWithHome();
    const project = await store.createProject("Delete me", panelHome);
    const room = await store.getRoom(project.projectId);
    const member = room.members[0]!;
    await store.setMemberAcpChatId(member.memberId, "acp-chat-1");
    const job = await store.createJob({
      projectId: project.projectId,
      memberId: member.memberId,
      messageId: null,
      brief: { persona: "", instruction: "", cwd: project.localPath || "/tmp", quotes: [], knowledge: [] },
      status: "completed"
    });
    await store.updateJob(job.jobId, { acpChatId: "acp-chat-2" });
    const scratchDir = path.join(panelHome, ".desktop", "scratch", "im", project.projectId);
    const attachmentsDir = path.join(panelHome, ".desktop", "im", project.projectId);
    await fs.mkdir(attachmentsDir, { recursive: true });
    await fs.writeFile(path.join(attachmentsDir, "note.txt"), "hi");

    const result = await store.deleteProject(project.projectId, panelHome);
    expect(result.deletedAcpChatIds.sort()).toEqual(["acp-chat-1", "acp-chat-2"]);
    expect(await store.getProject(project.projectId)).toBeUndefined();
    await expect(fs.stat(scratchDir)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.stat(attachmentsDir)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("allows overriding agent and model per room member and resetting to defaults", async () => {
    const store = await createStore();
    const project = await store.createProject("Custom Role Room");
    const room = await store.getRoom(project.projectId);
    const dev = room.members.find((m) => m.templateId === "role_developer")!;
    expect(dev.agent).toBe("claude");
    expect(dev.model).toBeUndefined();

    // Override agent and model for this room's member
    const updatedAgent = await store.setMemberAgent(dev.memberId, "codex");
    expect(updatedAgent.agent).toBe("codex");

    const updatedModel = await store.setMemberModel(dev.memberId, "o3-mini");
    expect(updatedModel.model).toBe("o3-mini");

    const updatedThought = await store.setMemberThoughtLevel(dev.memberId, "high");
    expect(updatedThought.thoughtLevel).toBe("high");

    const refetched = await store.getMember(dev.memberId);
    expect(refetched?.agent).toBe("codex");
    expect(refetched?.model).toBe("o3-mini");
    expect(refetched?.thoughtLevel).toBe("high");

    // Reset overrides to template default
    const reset = await store.resetMemberOverrides(dev.memberId);
    expect(reset.agent).toBe("claude");
    expect(reset.model).toBeUndefined();
    expect(reset.thoughtLevel).toBeUndefined();
  });

  it("defaults to 'New chat' when creating a project without a name and auto-renames with autoRenameProject", async () => {
    const store = await createStore();
    const project = await store.createProject("");
    expect(project.name).toBe("New chat");

    await store.insertMessage({
      projectId: project.projectId,
      kind: "human",
      authorLabel: "You",
      body: "How do I build a search bar with fuzzy matching?"
    });

    const renamed = await store.autoRenameProject(project.projectId, {} as any);
    expect(renamed.title).toContain("How do I build a search bar with fuzzy matching");
    expect((await store.getProject(project.projectId))?.name).toBe(renamed.title);
  });

  it("ensures .arp directory exists under associated folder and guides roles in dispatch prompt", async () => {
    const { store, panelHome } = await createStoreWithHome();
    const targetDir = path.join(panelHome, "my-code-repo");
    await fs.mkdir(targetDir, { recursive: true });

    const project = await store.createProject("Repo Chat");
    await store.setLocalPath(project.projectId, targetDir);

    const arpDir = path.join(targetDir, ".arp");
    const stat = await fs.stat(arpDir);
    expect(stat.isDirectory()).toBe(true);

    const prompt = buildDispatchPrompt({
      persona: "You are Developer.",
      instruction: "build feature",
      cwd: targetDir,
      quotes: [],
      knowledge: []
    });
    expect(prompt).toContain(".arp/");
  });
});
