import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
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
import { notesGetTaskWorkspaceContext, notesLinkSessionToTask } from "../notesService";
import type { ThunderScheduleInput } from "@agent-resume/core";

let configWatcher: fs.FSWatcher | null = null;

function startThunderConfigWatcher(): void {
  if (configWatcher) return;
  const home = os.homedir();
  const thunderDir = path.join(home, ".thunder");
  if (!fs.existsSync(thunderDir)) {
    try {
      fs.mkdirSync(thunderDir, { recursive: true });
    } catch {
      return;
    }
  }

  let debounceTimer: NodeJS.Timeout | null = null;
  const notifyChange = () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      console.log("[thunder-ipc] .thunder config changed, notifying renderers");
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) {
          win.webContents.send("thunder:models:changed");
        }
      }
    }, 300);
  };

  try {
    configWatcher = fs.watch(thunderDir, (_eventType, filename) => {
      if (filename && (filename.includes("models.json") || filename.includes("auth.json"))) {
        notifyChange();
      }
    });
  } catch (err) {
    console.warn("[thunder-ipc] Failed to watch .thunder dir:", err);
  }
}

export function registerThunderIpc(): void {
  startThunderConfigWatcher();

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

  safeHandle(
    "thunder:chat:generateTitle",
    async (_event, args: { sessionId: string; force?: boolean }) => {
      return getThunderClient().generateConversationTitle(args.sessionId, args.force ?? false);
    }
  );

  safeHandle(
    "thunder:chat:setTitle",
    async (_event, args: { sessionId: string; title: string }) => {
      return getThunderClient().setConversationTitle(args.sessionId, args.title);
    }
  );

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
        taskNoteId?: string;
        thinking_level?: string;
        useMock?: boolean;
      }
    ) => {
      const client = getThunderClient();
      const effectiveSessionId = args.sessionId || `sess_${Date.now()}`;

      let effectiveWorkspaceDir = args.workspaceDir;
      let gtdContext:
        | {
            title: string;
            status: string;
            backgroundMd: string;
            projects: string[];
            noteAbsPath?: string;
          }
        | undefined;

      if (args.taskNoteId) {
        try {
          const taskCtx = await notesGetTaskWorkspaceContext(args.taskNoteId);
          gtdContext = {
            title: taskCtx.title,
            status: taskCtx.status,
            backgroundMd: taskCtx.backgroundMd,
            projects: taskCtx.projects,
            noteAbsPath: taskCtx.noteAbsPath
          };
          if (!effectiveWorkspaceDir) {
            effectiveWorkspaceDir = taskCtx.dir;
          }
          // Link this chat session with the GTD task
          void notesLinkSessionToTask({
            noteId: args.taskNoteId,
            sessionKey: `chat:${effectiveSessionId}`,
            projectPath: effectiveWorkspaceDir
          }).catch((err) => {
            console.warn("[thunder-chat] failed to link session to task:", err);
          });
        } catch (err) {
          console.warn("[thunder-chat] failed to load GTD task workspace context:", err);
        }
      }

      return client.runTask({
        taskId: args.taskId,
        prompt: args.prompt,
        sessionId: effectiveSessionId,
        model: args.model,
        workspaceDir: effectiveWorkspaceDir,
        taskNoteId: args.taskNoteId,
        gtdContext,
        thinking_level: args.thinking_level,
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

  safeHandle("thunder:chat:getTrace", async (_event, args: { sessionId: string; taskId?: string }) => {
    return getThunderClient().getTrace(args);
  });

  safeHandle("thunder:chat:listTraces", async (_event, args: { sessionId: string }) => {
    return getThunderClient().listTraces(args);
  });
}
