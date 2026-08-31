import { dialog, type BrowserWindow } from "electron";
import { constants } from "node:fs";
import * as fs from "node:fs/promises";
import {
  effectivePanelHome,
  loadSettings,
  preparePanelDatabasesFromSettings
} from "@agent-resume/core";
import { safeHandle } from "../ipcUtils";
import { ImConductor, emitImEvent } from "./conductor";
import { runIndependentSelectionAction } from "./selectionRunner";
import { ImStore } from "./store";
import { isImAgent, isImSelectionActionKind, parseImRoleTools, type ImAgent, type ImEvent, type ImSelectionActionKind } from "./types";
import type { AcpStreamEvent } from "../acp/types";

let store: ImStore | null = null;
let conductor: ImConductor | null = null;
let storeKey = "";

type AcpHostApi = {
  connect: (chatId: string) => Promise<void>;
  prompt: (chatId: string, text: string) => Promise<void>;
  denyPermission: (requestId: string) => Promise<void>;
  setModel?: (chatId: string, modelId: string) => Promise<void>;
};

async function getStore(): Promise<ImStore> {
  const paths = await preparePanelDatabasesFromSettings();
  const key = paths.desktopDb;
  if (!store || storeKey !== key) {
    store = new ImStore(paths.desktopDb);
    await store.initialize();
    storeKey = key;
  }
  return store;
}

export function registerImIpc(deps: {
  getMainWindow: () => BrowserWindow | null;
  acp: AcpHostApi;
}): void {
  const emit = (event: ImEvent) => emitImEvent(deps.getMainWindow, event);

  const getConductor = async (): Promise<ImConductor> => {
    const nextStore = await getStore();
    if (!conductor) {
      conductor = new ImConductor(
        nextStore,
        emit,
        deps.acp.connect,
        deps.acp.prompt,
        deps.acp.denyPermission,
        deps.acp.setModel
      );
    }
    return conductor;
  };

  safeHandle("im:listProjects", async () => {
    const im = await getStore();
    return im.listProjects();
  });

  safeHandle("im:createProject", async (_event, args?: { name?: unknown }) => {
    const name = typeof args?.name === "string" ? args.name : "";
    const im = await getStore();
    return im.createProject(name);
  });

  safeHandle("im:renameProject", async (_event, args: { projectId?: unknown; name?: unknown }) => {
    if (typeof args?.projectId !== "string" || typeof args?.name !== "string") {
      throw new Error("Project id and name are required.");
    }
    const im = await getStore();
    return im.renameProject(args.projectId, args.name);
  });

  safeHandle("im:deleteProject", async (_event, args: { projectId?: unknown }) => {
    if (typeof args?.projectId !== "string") throw new Error("Project id is required.");
    const im = await getStore();
    await im.deleteProject(args.projectId);
    return { ok: true };
  });

  safeHandle("im:pickLocalPath", async (_event, args?: { title?: unknown }) => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory", "createDirectory"],
      title: typeof args?.title === "string" ? args.title : "Select project folder"
    });
    if (result.canceled || !result.filePaths[0]) {
      return { ok: false as const, canceled: true as const };
    }
    const absolutePath = result.filePaths[0];
    const stat = await fs.stat(absolutePath).catch(() => null);
    if (!stat?.isDirectory()) throw new Error("Selected folder is not a valid directory.");
    await fs.access(absolutePath, constants.R_OK);
    return { ok: true as const, path: absolutePath };
  });

  safeHandle("im:setLocalPath", async (_event, args: { projectId?: unknown; localPath?: unknown }) => {
    if (typeof args?.projectId !== "string") throw new Error("Project id is required.");
    const im = await getStore();
    const localPath = typeof args.localPath === "string" ? args.localPath : null;
    return im.setLocalPath(args.projectId, localPath);
  });

  safeHandle("im:listTemplates", async () => {
    const im = await getStore();
    return im.listTemplates();
  });

  safeHandle("im:setTemplateAgent", async (_event, args: { templateId?: unknown; agent?: unknown }) => {
    if (typeof args?.templateId !== "string" || typeof args?.agent !== "string" || !isImAgent(args.agent)) {
      throw new Error("IM only supports Pi, Claude Code, and Codex.");
    }
    const im = await getStore();
    return im.updateTemplate({ templateId: args.templateId, agent: args.agent as ImAgent });
  });

  safeHandle("im:createTemplate", async (_event, args: {
    name?: unknown;
    persona?: unknown;
    agent?: unknown;
    model?: unknown;
    tools?: unknown;
  }) => {
    if (typeof args?.name !== "string" || typeof args?.agent !== "string" || !isImAgent(args.agent)) {
      throw new Error("Role name and a Pi / Claude / Codex agent are required.");
    }
    const im = await getStore();
    return im.createTemplate({
      name: args.name,
      persona: typeof args.persona === "string" ? args.persona : "",
      agent: args.agent as ImAgent,
      model: typeof args.model === "string" ? args.model : undefined,
      tools: parseImRoleTools(args.tools)
    });
  });

  safeHandle("im:updateTemplate", async (_event, args: {
    templateId?: unknown;
    name?: unknown;
    persona?: unknown;
    agent?: unknown;
    model?: unknown;
    tools?: unknown;
  }) => {
    if (typeof args?.templateId !== "string") throw new Error("Template id is required.");
    if (args.agent !== undefined && (typeof args.agent !== "string" || !isImAgent(args.agent))) {
      throw new Error("IM only supports Pi, Claude Code, and Codex.");
    }
    const im = await getStore();
    return im.updateTemplate({
      templateId: args.templateId,
      name: typeof args.name === "string" ? args.name : undefined,
      persona: typeof args.persona === "string" ? args.persona : undefined,
      agent: typeof args.agent === "string" ? args.agent as ImAgent : undefined,
      model: args.model === null ? null : typeof args.model === "string" ? args.model : undefined,
      tools: args.tools === undefined ? undefined : parseImRoleTools(args.tools)
    });
  });

  safeHandle("im:deleteTemplate", async (_event, args: { templateId?: unknown }) => {
    if (typeof args?.templateId !== "string") throw new Error("Template id is required.");
    const im = await getStore();
    await im.deleteTemplate(args.templateId);
    return { ok: true };
  });

  safeHandle("im:getRoom", async (_event, args: { projectId?: unknown }) => {
    if (typeof args?.projectId !== "string") throw new Error("Project id is required.");
    const im = await getStore();
    return im.getRoom(args.projectId);
  });

  safeHandle("im:setMemberAgent", async (_event, args: { memberId?: unknown; agent?: unknown }) => {
    if (typeof args?.memberId !== "string" || typeof args?.agent !== "string" || !isImAgent(args.agent)) {
      throw new Error("IM only supports Pi, Claude Code, and Codex.");
    }
    const im = await getStore();
    return im.setMemberAgent(args.memberId, args.agent as ImAgent);
  });

  safeHandle("im:createRole", async (_event, args: {
    projectId?: unknown;
    name?: unknown;
    persona?: unknown;
    agent?: unknown;
    model?: unknown;
  }) => {
    if (typeof args?.projectId !== "string" || typeof args?.name !== "string") {
      throw new Error("Project id and role name are required.");
    }
    if (typeof args?.agent !== "string" || !isImAgent(args.agent)) {
      throw new Error("IM only supports Pi, Claude Code, and Codex.");
    }
    const im = await getStore();
    return im.createRole({
      projectId: args.projectId,
      name: args.name,
      persona: typeof args.persona === "string" ? args.persona : "",
      agent: args.agent as ImAgent,
      model: typeof args.model === "string" ? args.model : undefined
    });
  });

  safeHandle("im:addMember", async (_event, args: { projectId?: unknown; templateId?: unknown }) => {
    if (typeof args?.projectId !== "string" || typeof args?.templateId !== "string") {
      throw new Error("Project id and template id are required.");
    }
    const im = await getStore();
    return im.addMember(args.projectId, args.templateId);
  });

  safeHandle("im:removeMember", async (_event, args: { memberId?: unknown }) => {
    if (typeof args?.memberId !== "string") throw new Error("Member id is required.");
    const im = await getStore();
    await im.removeMember(args.memberId);
    return { ok: true };
  });

  safeHandle("im:postMessage", async (_event, args: {
    projectId?: unknown;
    body?: unknown;
    quoteIds?: unknown;
    mentionRoleIds?: unknown;
  }) => {
    if (typeof args?.projectId !== "string") throw new Error("Project id is required.");
    const quoteIds = Array.isArray(args.quoteIds)
      ? args.quoteIds.filter((item): item is string => typeof item === "string")
      : [];
    const mentionRoleIds = Array.isArray(args.mentionRoleIds)
      ? args.mentionRoleIds.filter((item): item is string => typeof item === "string")
      : [];
    const runner = await getConductor();
    return runner.postMessage({
      projectId: args.projectId,
      body: typeof args.body === "string" ? args.body : "",
      quoteIds,
      mentionRoleIds
    });
  });

  safeHandle("im:cancelJob", async (_event, args: { jobId?: unknown }) => {
    if (typeof args?.jobId !== "string") throw new Error("Job id is required.");
    const runner = await getConductor();
    return runner.cancelJob(args.jobId);
  });

  safeHandle("im:listKnowledge", async (_event, args: { projectId?: unknown }) => {
    if (typeof args?.projectId !== "string") throw new Error("Project id is required.");
    const im = await getStore();
    return im.listKnowledge(args.projectId);
  });

  safeHandle("im:addKnowledgeText", async (_event, args: { projectId?: unknown; title?: unknown; body?: unknown }) => {
    if (typeof args?.projectId !== "string") throw new Error("Project id is required.");
    const im = await getStore();
    return im.addKnowledgeText(
      args.projectId,
      typeof args.title === "string" ? args.title : "",
      typeof args.body === "string" ? args.body : ""
    );
  });

  safeHandle("im:addKnowledgeLink", async (_event, args: {
    projectId?: unknown;
    url?: unknown;
    title?: unknown;
    note?: unknown;
  }) => {
    if (typeof args?.projectId !== "string" || typeof args?.url !== "string") {
      throw new Error("Project id and URL are required.");
    }
    const im = await getStore();
    return im.addKnowledgeLink(
      args.projectId,
      args.url,
      typeof args.title === "string" ? args.title : undefined,
      typeof args.note === "string" ? args.note : undefined
    );
  });

  safeHandle("im:addKnowledgeImage", async (_event, args: { projectId?: unknown }) => {
    if (typeof args?.projectId !== "string") throw new Error("Project id is required.");
    const picked = await dialog.showOpenDialog({
      properties: ["openFile"],
      filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif"] }]
    });
    if (picked.canceled || !picked.filePaths[0]) {
      return { ok: false as const, canceled: true as const };
    }
    const sourcePath = picked.filePaths[0];
    const ext = sourcePath.toLowerCase();
    const mimeType = ext.endsWith(".png")
      ? "image/png"
      : ext.endsWith(".webp")
        ? "image/webp"
        : ext.endsWith(".gif")
          ? "image/gif"
          : "image/jpeg";
    const settings = await loadSettings();
    const im = await getStore();
    const item = await im.addKnowledgeImage({
      projectId: args.projectId,
      panelHome: effectivePanelHome(settings),
      sourcePath,
      mimeType,
      fileName: sourcePath.split(/[\\/]/).pop() || "image"
    });
    return { ok: true as const, item };
  });

  safeHandle("im:removeKnowledge", async (_event, args: { itemId?: unknown }) => {
    if (typeof args?.itemId !== "string") throw new Error("Item id is required.");
    const settings = await loadSettings();
    const im = await getStore();
    await im.removeKnowledge(args.itemId, effectivePanelHome(settings));
    return { ok: true };
  });

  safeHandle("im:listSelectionActions", async () => {
    const im = await getStore();
    return im.listSelectionActions();
  });

  safeHandle("im:createSelectionAction", async (_event, args: {
    name?: unknown;
    kind?: unknown;
    prompt?: unknown;
    providerId?: unknown;
    modelId?: unknown;
  }) => {
    if (typeof args?.name !== "string" || typeof args?.kind !== "string" || !isImSelectionActionKind(args.kind)) {
      throw new Error("Action name and kind are required.");
    }
    const im = await getStore();
    return im.createSelectionAction({
      name: args.name,
      kind: args.kind as ImSelectionActionKind,
      prompt: typeof args.prompt === "string" ? args.prompt : "",
      providerId: typeof args.providerId === "string" ? args.providerId.trim() || undefined : undefined,
      modelId: typeof args.modelId === "string" ? args.modelId.trim() || undefined : undefined
    });
  });

  safeHandle("im:updateSelectionAction", async (_event, args: {
    actionId?: unknown;
    name?: unknown;
    kind?: unknown;
    prompt?: unknown;
    providerId?: unknown;
    modelId?: unknown;
    enabled?: unknown;
  }) => {
    if (typeof args?.actionId !== "string") throw new Error("Action id is required.");
    const im = await getStore();
    return im.updateSelectionAction({
      actionId: args.actionId,
      name: typeof args.name === "string" ? args.name : undefined,
      kind: typeof args.kind === "string" && isImSelectionActionKind(args.kind) ? args.kind : undefined,
      prompt: typeof args.prompt === "string" ? args.prompt : undefined,
      providerId: typeof args.providerId === "string" ? args.providerId.trim() || null : args.providerId === null ? null : undefined,
      modelId: typeof args.modelId === "string" ? args.modelId.trim() || null : args.modelId === null ? null : undefined,
      enabled: typeof args.enabled === "boolean" ? args.enabled : undefined
    });
  });

  safeHandle("im:deleteSelectionAction", async (_event, args: { actionId?: unknown }) => {
    if (typeof args?.actionId !== "string") throw new Error("Action id is required.");
    const im = await getStore();
    await im.deleteSelectionAction(args.actionId);
    return { ok: true };
  });

  safeHandle("im:runSelectionAction", async (_event, args: { actionId?: unknown; text?: unknown }) => {
    if (typeof args?.actionId !== "string") throw new Error("Action id is required.");
    const im = await getStore();
    return runIndependentSelectionAction(im, args.actionId, typeof args.text === "string" ? args.text : "");
  });
}

export async function handleImAcpStream(event: AcpStreamEvent): Promise<void> {
  if (!conductor) return;
  await conductor.handleAcpStream(event);
}

export function resetImRuntimeForTests(): void {
  store = null;
  conductor = null;
  storeKey = "";
}
