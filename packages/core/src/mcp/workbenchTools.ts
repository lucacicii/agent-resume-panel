import { z } from "zod";
import {
  getTaskWorkbench,
  listTaskWorkbenches,
  listTaskWorkbenchSessionLinks
} from "../catalog/taskWorkbenches";

/**
 * Workbench tools (read-only).
 *
 * A workbench is a desktop-only unit of work under a task: it binds to one
 * project root (or the task's neutral workspace when `projectPath` is null) and
 * owns its own pane layout and session set. These tables live in `desktop.db`,
 * which the extension does not have — reads degrade to "no workbenches".
 *
 * External MCP callers cannot open Desktop's Workbench UI, so these tools only
 * expose the binding and its sessions.
 */
export interface WorkbenchToolContext {
  desktopDb: string;
}

export const workbenchListSchema = {
  taskNoteId: z.string().min(1).describe("Task note id whose workbenches should be listed.")
};

export const workbenchReadSchema = {
  workbenchId: z.string().min(1).describe("Workbench id (from workbench_list).")
};

type WorkbenchToolResult = { content: Array<{ type: "text"; text: string }> };

function textResult(data: unknown): WorkbenchToolResult {
  return {
    content: [{ type: "text", text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }]
  };
}

export async function handleWorkbenchList(
  args: { taskNoteId: string },
  ctx: WorkbenchToolContext
): Promise<WorkbenchToolResult> {
  const taskNoteId = args.taskNoteId?.trim();
  if (!taskNoteId) throw new Error("taskNoteId is required.");
  let workbenches;
  try {
    workbenches = await listTaskWorkbenches(ctx.desktopDb, taskNoteId);
  } catch {
    return textResult(`No workbenches: the desktop workbench tables are unavailable for task ${taskNoteId}.`);
  }
  if (!workbenches.length) {
    return textResult(`Task ${taskNoteId} has no workbenches.`);
  }
  const payload = await Promise.all(
    workbenches.map(async (wb) => {
      const sessions = await listTaskWorkbenchSessionLinks(ctx.desktopDb, wb.workbenchId).catch(() => []);
      return {
        workbenchId: wb.workbenchId,
        name: wb.name,
        rootPath: wb.projectPath,
        position: wb.position,
        sessionCount: sessions.length,
        updatedAtMs: wb.updatedAtMs
      };
    })
  );
  return textResult(`Listed ${payload.length} workbench(es):\n${JSON.stringify(payload, null, 2)}`);
}

export async function handleWorkbenchRead(
  args: { workbenchId: string },
  ctx: WorkbenchToolContext
): Promise<WorkbenchToolResult> {
  const workbenchId = args.workbenchId?.trim();
  if (!workbenchId) throw new Error("workbenchId is required.");
  let workbench;
  try {
    workbench = await getTaskWorkbench(ctx.desktopDb, workbenchId);
  } catch {
    throw new Error(`Workbench not found: ${workbenchId} (desktop workbench tables unavailable).`);
  }
  if (!workbench) throw new Error(`Workbench not found: ${workbenchId}.`);
  const sessions = await listTaskWorkbenchSessionLinks(ctx.desktopDb, workbenchId).catch(() => []);
  return textResult({
    workbenchId: workbench.workbenchId,
    taskNoteId: workbench.taskNoteId,
    name: workbench.name,
    rootPath: workbench.projectPath,
    position: workbench.position,
    layoutJson: workbench.layoutJson,
    sessions,
    createdAtMs: workbench.createdAtMs,
    updatedAtMs: workbench.updatedAtMs
  });
}
