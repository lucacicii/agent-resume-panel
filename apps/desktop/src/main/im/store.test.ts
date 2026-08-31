import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { desktopDbPath, ensureDesktopDbSchema } from "@agent-resume/core";
import { buildDispatchPrompt, fillSelectionPrompt, ImStore } from "./store";

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
  await Promise.all(homes.splice(0).map((home) => fs.rm(home, { recursive: true, force: true })));
});

describe("ImStore", () => {
  it("creates a user-owned project with the five builtin roles", async () => {
    const store = await createStore();
    const project = await store.createProject("Room One");
    const room = await store.getRoom(project.projectId);
    expect(project.localPath).toBeNull();
    expect(room.members.map((member) => member.templateId)).toEqual([
      "role_product_manager",
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
      "role_project_manager",
      "role_ui_designer",
      "role_developer",
      "role_tester"
    ]);
    await store.initialize();
    const again = await store.listTemplates();
    expect(again).toHaveLength(5);
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
    expect(store.memberNeedsExclusiveLock(developer)).toBe(true);
    expect(store.memberNeedsExclusiveLock(tester)).toBe(true);
    expect(store.memberNeedsExclusiveLock(pm)).toBe(false);
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
    expect(after.members).toHaveLength(4);
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
});
