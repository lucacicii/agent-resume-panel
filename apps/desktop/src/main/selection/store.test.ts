import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { desktopDbPath, ensureDesktopDbSchema } from "@agent-resume/core";
import { fillSelectionPrompt, SelectionStore } from "./store";

const homes: string[] = [];

async function createStore(): Promise<SelectionStore> {
  const panelHome = await fs.mkdtemp(path.join(os.tmpdir(), "agent-resume-selection-"));
  homes.push(panelHome);
  const dbPath = desktopDbPath(panelHome);
  await fs.mkdir(path.dirname(dbPath), { recursive: true });
  await ensureDesktopDbSchema(dbPath);
  const store = new SelectionStore(dbPath);
  await store.initialize();
  return store;
}

afterEach(async () => {
  await Promise.all(homes.splice(0).map((home) => fs.rm(home, { recursive: true, force: true })));
});

describe("SelectionStore", () => {
  it("seeds builtin selection actions and blocks deleting them", async () => {
    const store = await createStore();
    const actions = await store.listSelectionActions();
    expect(actions.map((item) => item.actionId)).toEqual(["translate", "explain"]);
    await expect(store.deleteSelectionAction("translate")).rejects.toThrow(/cannot be deleted/i);
    const custom = await store.createSelectionAction({
      name: "Summarize",
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
    expect((await store.listSelectionActions()).map((item) => item.actionId)).toEqual(["translate", "explain"]);
  });

  it("atomically reorders selection actions after validating the complete id list", async () => {
    const store = await createStore();
    const custom = await store.createSelectionAction({
      name: "Summarize",
      prompt: "Summarize:\n{selection}"
    });
    const before = await store.listSelectionActions();
    const ids = before.map((item) => item.actionId);
    const builtinIds = ids.filter((id) => id !== custom.actionId);

    await expect(store.reorderSelectionActions([ids[0]!, ids[0]!, ids[1]!])).rejects.toThrow(/unique/i);
    await expect(store.reorderSelectionActions(ids.slice(0, -1))).rejects.toThrow(/exactly once/i);
    await expect(store.reorderSelectionActions([...ids, "missing-action"])).rejects.toThrow(/exactly once/i);
    expect((await store.listSelectionActions()).map((item) => item.actionId)).toEqual(ids);

    const reordered = await store.reorderSelectionActions([custom.actionId, ...builtinIds]);
    expect(reordered.map((item) => item.actionId)).toEqual([custom.actionId, ...builtinIds]);
    expect(reordered.map((item) => item.sortOrder)).toEqual([0, 1, 2]);
  });
});
