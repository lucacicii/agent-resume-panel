import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { desktopDbPath, ensureDesktopDbSchema } from "@agent-resume/core";
import { buildDispatchPrompt, buildIncrementalPrompt, fillSelectionPrompt, ImStore } from "./store";

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
  it("creates a user-owned project with the seven builtin roles", async () => {
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
      "role_tester",
      "role_memory"
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
      "role_tester",
      "role_memory"
    ]);
    await store.initialize();
    const again = await store.listTemplates();
    expect(again).toHaveLength(7);
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
    expect(after.members).toHaveLength(6);
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

  it("builds an incremental prompt without repeating persona or knowledge", () => {
    const followUp = buildIncrementalPrompt({
      persona: "You are Developer.",
      instruction: "add more detail",
      cwd: "/tmp/app",
      quotes: [],
      knowledge: []
    });
    expect(followUp).toBe("add more detail");
    expect(followUp).not.toContain("[Role persona]");

    const quoted = buildIncrementalPrompt({
      persona: "You are Developer.",
      instruction: "rewrite this",
      cwd: "/tmp/app",
      quotes: [{
        messageId: "m1",
        authorLabel: "You",
        body: "old plan",
        createdAtMs: 1,
        truncated: false
      }],
      knowledge: []
    });
    expect(quoted).toContain("[Quoted messages]");
    expect(quoted).toContain("old plan");
    expect(quoted).toContain("rewrite this");
    expect(quoted).not.toContain("[Role persona]");
    expect(quoted).not.toContain("[Background knowledge]");
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

  it("keeps live ACP jobs running across store reinitialization", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "im-store-live-"));
    try {
      const dbPath = path.join(dir, "desktop.db");
      const firstStore = new ImStore(dbPath);
      await firstStore.initialize();
      const project = await firstStore.createProject("Live ACP");
      const room = await firstStore.getRoom(project.projectId);
      const pm = room.members.find((m) => m.templateId === "role_product_manager")!;
      const live = await firstStore.createJob({
        projectId: project.projectId,
        memberId: pm.memberId,
        messageId: null,
        brief: { persona: "", instruction: "keep going", cwd: "/tmp", quotes: [], knowledge: [] },
        status: "running"
      });
      await firstStore.updateJob(live.jobId, { acpChatId: "chat-still-live" });
      const dead = await firstStore.createJob({
        projectId: project.projectId,
        memberId: pm.memberId,
        messageId: null,
        brief: { persona: "", instruction: "stale", cwd: "/tmp", quotes: [], knowledge: [] },
        status: "queued"
      });

      const restarted = new ImStore(dbPath);
      const kept = await restarted.initialize({ liveAcpChatIds: ["chat-still-live"] });
      expect(kept.map((job) => job.jobId)).toEqual([live.jobId]);
      expect((await restarted.getJob(live.jobId))?.status).toBe("running");
      expect((await restarted.getJob(dead.jobId))?.status).toBe("cancelled");
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

  it("supports bi-directional delegation relationship configuration and pruning on deletion", async () => {
    const store = await createStore();
    const devOps = await store.createTemplate({
      name: "DevOps",
      persona: "You are DevOps engineer.",
      agent: "claude",
      callableTemplateIds: ["role_developer", "role_tester"],
      incomingCallerIds: ["role_architect"],
      autoDispatch: true
    });

    expect(devOps.callableTemplateIds).toEqual(["role_developer", "role_tester"]);
    expect(devOps.autoDispatch).toBe(true);

    // Verify incomingCaller was updated
    const architect = await store.getTemplate("role_architect");
    expect(architect?.callableTemplateIds).toContain(devOps.templateId);

    // Update incoming callers
    await store.updateTemplate({
      templateId: devOps.templateId,
      incomingCallerIds: ["role_product_manager"]
    });

    const architectAfter = await store.getTemplate("role_architect");
    expect(architectAfter?.callableTemplateIds).not.toContain(devOps.templateId);

    const pmAfter = await store.getTemplate("role_product_manager");
    expect(pmAfter?.callableTemplateIds).toContain(devOps.templateId);

    // Delete template and verify pruning
    await store.deleteTemplate(devOps.templateId);
    const pmFinal = await store.getTemplate("role_product_manager");
    expect(pmFinal?.callableTemplateIds).not.toContain(devOps.templateId);
  });

  it("injects callable downstream roles into dispatch prompt", () => {
    const prompt = buildDispatchPrompt(
      {
        persona: "You are Architect.",
        instruction: "design system",
        cwd: "/tmp",
        quotes: [],
        knowledge: []
      },
      [
        { templateId: "role_developer", name: "Developer", persona: "Implement features." },
        { templateId: "tpl_devops", name: "DevOps", persona: "Deploy apps." }
      ]
    );

    expect(prompt).toContain("[Callable Downstream Roles]");
    expect(prompt).toContain("Developer (id: role_developer)");
    expect(prompt).toContain("DevOps (id: tpl_devops)");
    expect(prompt).toContain("<im_dispatch");
  });

  it("automatically synchronizes project-scoped file roles from .arp/roles/*.md", async () => {
    const { store, panelHome } = await createStoreWithHome();
    const repoDir = path.join(panelHome, "repo-with-roles");
    const rolesDir = path.join(repoDir, ".arp", "roles");
    await fs.mkdir(rolesDir, { recursive: true });

    // 1. Create .arp/roles/dba.md
    await fs.writeFile(
      path.join(rolesDir, "dba.md"),
      `---
name: DBA Specialist
agent: pi
model: deepseek-reasoner
callable:
  - Developer
autoDispatch: true
---
You are DBA.`
    );

    const project = await store.createProject("DB Project");
    await store.setLocalPath(project.projectId, repoDir);

    const room = await store.getRoom(project.projectId);
    const dbaMember = room.members.find((m) => m.templateId === "project_role_dba");
    expect(dbaMember).toBeDefined();
    expect(dbaMember?.name).toBe("DBA Specialist");
    expect(dbaMember?.agent).toBe("pi");
    expect(dbaMember?.model).toBe("deepseek-reasoner");
    expect(dbaMember?.source).toBe("project");
    expect(dbaMember?.callableTemplateIds).toContain("role_developer");
    expect(dbaMember?.autoDispatch).toBe(true);

    // 2. Update .arp/roles/dba.md
    await fs.writeFile(
      path.join(rolesDir, "dba.md"),
      `---
name: Lead DBA
agent: claude
---
Updated persona.`
    );

    const updatedRoom = await store.getRoom(project.projectId);
    const updatedDba = updatedRoom.members.find((m) => m.templateId === "project_role_dba");
    expect(updatedDba?.name).toBe("Lead DBA");
    expect(updatedDba?.agent).toBe("claude");
    expect(updatedDba?.persona).toBe("Updated persona.");

    // 3. Delete .arp/roles/dba.md
    await fs.rm(path.join(rolesDir, "dba.md"));
    const cleanedRoom = await store.getRoom(project.projectId);
    expect(cleanedRoom.members.some((m) => m.templateId === "project_role_dba")).toBe(false);
  });
});
