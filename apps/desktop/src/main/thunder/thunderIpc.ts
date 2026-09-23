import { BrowserWindow } from "electron";
import { safeHandle } from "../ipcUtils";
import {
  cancelScheduleRun,
  createSchedule,
  deleteSchedule,
  getSchedule,
  getScheduleRun,
  listScheduleRuns,
  listSchedules,
  runScheduleNow,
  toggleSchedule,
  updateSchedule
} from "./thunderScheduler";
import { getThunderClient } from "./thunderClient";
import type { ThunderScheduleInput } from "@agent-resume/core";

export function registerThunderIpc(): void {
  safeHandle("schedule:list", async () => {
    return listSchedules();
  });

  safeHandle("schedule:get", async (_event, args: { id: string }) => {
    return getSchedule(args.id);
  });

  safeHandle("schedule:create", async (_event, args: { input: ThunderScheduleInput }) => {
    return createSchedule(args.input);
  });

  safeHandle(
    "schedule:update",
    async (_event, args: { id: string; input: Partial<ThunderScheduleInput> }) => {
      return updateSchedule(args.id, args.input);
    }
  );

  safeHandle("schedule:delete", async (_event, args: { id: string }) => {
    return deleteSchedule(args.id);
  });

  safeHandle("schedule:toggle", async (_event, args: { id: string; enabled: boolean }) => {
    return toggleSchedule(args.id, args.enabled);
  });

  safeHandle("schedule:runNow", async (_event, args: { id: string }) => {
    return runScheduleNow(args.id);
  });

  safeHandle("schedule:cancelRun", async (_event, args: { runId: string }) => {
    return cancelScheduleRun(args.runId);
  });

  safeHandle(
    "schedule:listRuns",
    async (_event, args: { scheduleId: string; limit?: number }) => {
      return listScheduleRuns(args.scheduleId, args.limit);
    }
  );

  safeHandle("schedule:getRun", async (_event, args: { runId: string }) => {
    return getScheduleRun(args.runId);
  });

  safeHandle("thunder:status", async () => {
    return getThunderClient().getStatus();
  });

  safeHandle("thunder:listModels", async () => {
    return getThunderClient().listModels();
  });

  safeHandle("thunder:chat:listConversations", async () => {
    return getThunderClient().listConversations();
  });

  safeHandle("thunder:chat:getConversation", async (_event, args: { sessionId: string }) => {
    return getThunderClient().getConversation(args.sessionId);
  });

  safeHandle("thunder:chat:deleteConversation", async (_event, args: { sessionId: string }) => {
    return getThunderClient().deleteConversation(args.sessionId);
  });

  safeHandle(
    "thunder:chat:truncateConversation",
    async (_event, args: { sessionId: string; keepCount: number }) => {
      return getThunderClient().truncateConversation(args.sessionId, args.keepCount);
    }
  );

  safeHandle(
    "thunder:chat:runTask",
    async (
      _event,
      args: {
        taskId: string;
        prompt: string;
        sessionId?: string;
        model?: string;
        workspaceDir?: string;
        useMock?: boolean;
      }
    ) => {
      const client = getThunderClient();
      const effectiveSessionId = args.sessionId || `sess_${Date.now()}`;
      return client.runTask({
        taskId: args.taskId,
        prompt: args.prompt,
        sessionId: effectiveSessionId,
        model: args.model,
        workspaceDir: args.workspaceDir,
        useMock: args.useMock,
        onEvent: (event) => {
          for (const win of BrowserWindow.getAllWindows()) {
            if (win.isDestroyed()) continue;
            try {
              win.webContents.send("thunder:chat:event", {
                taskId: args.taskId,
                sessionId: effectiveSessionId,
                event
              });
            } catch {
              // ignore when window destroyed
            }
          }
        }
      });
    }
  );

  safeHandle("thunder:chat:cancelTask", async (_event, args: { taskId: string }) => {
    return getThunderClient().cancelTask(args.taskId);
  });
}
