import { ipcMain } from "electron";
import {
  flowBindSession,
  flowCreate,
  flowDelete,
  flowGet,
  flowList,
  flowRunCancel,
  flowRunCompleteNode,
  flowRunGet,
  flowRunLatest,
  flowRunMarkNodeRunning,
  flowRunRetryNode,
  flowRunSetNodeStatus,
  flowRunSkipNode,
  flowRunStart,
  flowTemplateDelete,
  flowTemplateInstantiate,
  flowTemplateList,
  flowTemplateSave,
  flowUpdateGraph
} from "./flowService";

function changed(event: Electron.IpcMainInvokeEvent, detail: { flowId?: string; runId?: string } = {}): void {
  event.sender.send("flow:changed", detail);
}

export function registerFlowIpc(): void {
  ipcMain.handle("flow:list", (_event, args?: { projectId?: string }) => flowList(args?.projectId));
  ipcMain.handle("flow:get", (_event, args: { flowId: string }) => flowGet(args.flowId));
  ipcMain.handle("flow:create", async (event, args: { projectId: string; projectPath: string; name: string }) => {
    const result = await flowCreate(args);
    changed(event, { flowId: result.flowId });
    return result;
  });
  ipcMain.handle("flow:updateGraph", async (event, args: Parameters<typeof flowUpdateGraph>[0]) => {
    const result = await flowUpdateGraph(args);
    changed(event, { flowId: result.flowId });
    return result;
  });
  ipcMain.handle("flow:delete", async (event, args: { flowId: string }) => {
    const result = await flowDelete(args.flowId);
    changed(event, { flowId: args.flowId });
    return result;
  });
  ipcMain.handle("flow:templatesList", () => flowTemplateList());
  ipcMain.handle("flow:templateSave", async (event, args: Parameters<typeof flowTemplateSave>[0]) => {
    const result = await flowTemplateSave(args);
    changed(event);
    return result;
  });
  ipcMain.handle("flow:templateDelete", async (event, args: { templateId: string }) => {
    const result = await flowTemplateDelete(args.templateId);
    changed(event);
    return result;
  });
  ipcMain.handle("flow:templateInstantiate", async (event, args: Parameters<typeof flowTemplateInstantiate>[0]) => {
    const result = await flowTemplateInstantiate(args);
    changed(event, { flowId: result.flowId });
    return result;
  });
  ipcMain.handle("flow:runStart", async (event, args: { flowId: string }) => {
    const result = await flowRunStart(args.flowId);
    changed(event, { flowId: result.flow.flowId, runId: result.run.runId });
    return result;
  });
  ipcMain.handle("flow:runGet", (_event, args: { runId: string }) => flowRunGet(args.runId));
  ipcMain.handle("flow:runLatest", (_event, args: { flowId: string }) => flowRunLatest(args.flowId));
  ipcMain.handle("flow:runMarkNodeRunning", async (event, args: Parameters<typeof flowRunMarkNodeRunning>[0]) => {
    const result = await flowRunMarkNodeRunning(args);
    changed(event, { flowId: result.flow.flowId, runId: args.runId });
    return result;
  });
  ipcMain.handle("flow:bindSession", async (event, args: Parameters<typeof flowBindSession>[0]) => {
    const result = await flowBindSession(args);
    changed(event, { flowId: args.flowId });
    return result;
  });
  ipcMain.handle("flow:runCompleteNode", async (event, args: Parameters<typeof flowRunCompleteNode>[0]) => {
    const result = await flowRunCompleteNode(args);
    changed(event, { flowId: result.flow.flowId, runId: args.runId });
    return result;
  });
  ipcMain.handle("flow:runSetNodeStatus", async (event, args: Parameters<typeof flowRunSetNodeStatus>[0]) => {
    const result = await flowRunSetNodeStatus(args);
    changed(event, { flowId: args.flowId, runId: args.runId });
    return result;
  });
  ipcMain.handle("flow:runRetryNode", async (event, args: Parameters<typeof flowRunRetryNode>[0]) => {
    const result = await flowRunRetryNode(args);
    changed(event, { flowId: result.flow.flowId, runId: args.runId });
    return result;
  });
  ipcMain.handle("flow:runSkipNode", async (event, args: Parameters<typeof flowRunSkipNode>[0]) => {
    const result = await flowRunSkipNode(args);
    changed(event, { flowId: result.flow.flowId, runId: args.runId });
    return result;
  });
  ipcMain.handle("flow:runCancel", async (event, args: Parameters<typeof flowRunCancel>[0]) => {
    const result = await flowRunCancel(args);
    changed(event, { flowId: result.flow.flowId, runId: args.runId });
    return result;
  });
}
