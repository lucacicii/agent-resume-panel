import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { desktopDbPath, ensureDesktopDbSchema } from "@agent-resume/core";
import { buildDispatchPrompt, ImStore } from "./store";

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

  it("snapshots quoted messages into the dispatch prompt", async () => {
    const store = await createStore();
    const project = await store.createProject("Quoted");
    const first = await store.insertMessage({
      projectId: project.projectId,
      kind: "human",
      authorLabel: "You",
      body: "Use the existing auth helper."
    });
    const quotes = await store.resolveQuotes(project.projectId, [first.messageId]);
    const prompt = buildDispatchPrompt({
      persona: "You are Developer.",
      instruction: "Implement login.",
      cwd: "/tmp/app",
      quotes,
      knowledge: []
    });
    expect(prompt).toContain("Use the existing auth helper.");
    expect(prompt).toContain("Implement login.");
    expect(prompt).toContain("/tmp/app");
  });
});
