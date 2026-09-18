import { preparePanelDatabasesFromSettings } from "@agent-resume/core";
import { safeHandle } from "../ipcUtils";
import { runSelectionAction } from "./runner";
import { SelectionStore } from "./store";

let store: SelectionStore | null = null;
let storeKey = "";

async function getStore(): Promise<SelectionStore> {
  const paths = await preparePanelDatabasesFromSettings();
  const key = paths.desktopDb;
  if (!store || storeKey !== key) {
    store = new SelectionStore(paths.desktopDb);
    await store.initialize();
    storeKey = key;
  }
  return store;
}

export function registerSelectionIpc(): void {
  safeHandle("selection:listActions", async () => {
    const selection = await getStore();
    return selection.listSelectionActions();
  });

  safeHandle("selection:createAction", async (_event, args: {
    name?: unknown;
    prompt?: unknown;
    providerId?: unknown;
    modelId?: unknown;
  }) => {
    if (typeof args?.name !== "string") {
      throw new Error("Action name is required.");
    }
    const selection = await getStore();
    return selection.createSelectionAction({
      name: args.name,
      prompt: typeof args.prompt === "string" ? args.prompt : "",
      providerId: typeof args.providerId === "string" ? args.providerId.trim() || undefined : undefined,
      modelId: typeof args.modelId === "string" ? args.modelId.trim() || undefined : undefined
    });
  });

  safeHandle("selection:updateAction", async (_event, args: {
    actionId?: unknown;
    name?: unknown;
    prompt?: unknown;
    providerId?: unknown;
    modelId?: unknown;
    enabled?: unknown;
  }) => {
    if (typeof args?.actionId !== "string") throw new Error("Action id is required.");
    const selection = await getStore();
    return selection.updateSelectionAction({
      actionId: args.actionId,
      name: typeof args.name === "string" ? args.name : undefined,
      prompt: typeof args.prompt === "string" ? args.prompt : undefined,
      providerId: typeof args.providerId === "string" ? args.providerId.trim() || null : args.providerId === null ? null : undefined,
      modelId: typeof args.modelId === "string" ? args.modelId.trim() || null : args.modelId === null ? null : undefined,
      enabled: typeof args.enabled === "boolean" ? args.enabled : undefined
    });
  });

  safeHandle("selection:deleteAction", async (_event, args: { actionId?: unknown }) => {
    if (typeof args?.actionId !== "string") throw new Error("Action id is required.");
    const selection = await getStore();
    await selection.deleteSelectionAction(args.actionId);
    return { ok: true };
  });

  safeHandle("selection:reorderActions", async (_event, args: { actionIds?: unknown }) => {
    if (
      !Array.isArray(args?.actionIds) ||
      args.actionIds.some((id) => typeof id !== "string" || !id.trim())
    ) {
      throw new Error("A complete list of selection action ids is required.");
    }
    const selection = await getStore();
    return selection.reorderSelectionActions(args.actionIds as string[]);
  });

  safeHandle("selection:runAction", async (_event, args: { actionId?: unknown; text?: unknown }) => {
    if (typeof args?.actionId !== "string") throw new Error("Action id is required.");
    const selection = await getStore();
    return runSelectionAction(selection, args.actionId, typeof args.text === "string" ? args.text : "");
  });
}
