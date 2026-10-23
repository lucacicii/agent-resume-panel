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
import { createThunderConfigStore, thunderDataDir } from "./thunderConfig";
import {
  accumulateStreamEvent,
  createActiveStreamSnapshot,
  dropPendingQuestion,
  finishActiveStream,
  getActiveStream
} from "./thunderStreamBuffer";
import { notesGetTaskWorkspaceContext, notesLinkSessionToTask } from "../notesService";
import type { ThunderModelsConfig, ThunderScheduleInput } from "@agent-resume/core";

let configWatcher: fs.FSWatcher | null = null;

/**
 * Push the daemon's *session-scoped* frames to every window.
 *
 * Every other frame reaches the renderer through the run that owns it
 * (`thunder:chat:event`, wired inside the runTask handler). A mode change and a
 * permission dialog are precisely the frames that arrive when nothing is
 * running — the user toggling plan mode before sending, or the agent asking to
 * write during a run it will block — so they get their own channel rather than
 * being smuggled into a stream that means "events of task X".
 *
 * Registered once, for the process lifetime.
 */
function registerSessionScopedThunderBroadcasts(): void {
  const broadcast = (channel: string, payload: unknown) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed()) continue;
      try {
        win.webContents.send(channel, payload);
      } catch {
        // ignore when window destroyed
      }
    }
  };

  const client = getThunderClient();
  client.onModeChanged((payload) => broadcast("thunder:mode:changed", payload));
}

function startThunderConfigWatcher(): void {
  if (configWatcher) return;
  const thunderDir = thunderDataDir();
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
      if (
        filename &&
        (filename.includes("models.json") ||
          filename.includes("auth.json"))
      ) {
        notifyChange();
      }
    });
  } catch (err) {
    console.warn("[thunder-ipc] Failed to watch .thunder dir:", err);
  }
}

export function registerThunderIpc(): void {
  startThunderConfigWatcher();
  const config = createThunderConfigStore();
  registerSessionScopedThunderBroadcasts();

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

  safeHandle("thunder:readModelsConfig", () => config.readModelsConfig());

  safeHandle(
    "thunder:writeModelsConfig",
    (_event, args: { config: ThunderModelsConfig }) => config.writeModelsConfig(args?.config)
  );

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
        /** Pin this run's approval mode; omitted until the user picks one. */
        mode?: import("@agent-resume/core").ThunderPermissionMode;
        attachments?: import("@agent-resume/core").ThunderImageAttachment[];
      }
    ) => {
      const client = getThunderClient();
      const effectiveSessionId = args.sessionId || `sess_${Date.now()}`;

      let effectiveWorkspaceDir = args.workspaceDir;
      let extraWorkspaceDirs: string[] | undefined;
      let gtdContext:
        | {
            title: string;
            status: string;
            backgroundMd: string;
            projects: string[];
            noteAbsPath?: string;
            worktreeLines?: string[];
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
            noteAbsPath: taskCtx.noteAbsPath,
            worktreeLines: taskCtx.worktreeLines
          };
          if (!effectiveWorkspaceDir) {
            effectiveWorkspaceDir = taskCtx.dir;
          }
          // Referenced repositories join the jail as extra roots: same
          // read/write standing as the neutral workspace, so read_file /
          // write_file / shell targets inside them stop tripping the path
          // traversal guard. Only directories that actually exist on this
          // machine are passed (synced-from-elsewhere paths are skipped). The
          // task's worktrees belong here for the same reason — an agent working
          // in one has to be able to write to it.
          extraWorkspaceDirs = [...taskCtx.projects, ...taskCtx.worktreeDirs].filter((projectDir) => {
            try {
              return fs.statSync(projectDir).isDirectory();
            } catch {
              return false;
            }
          });
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

      const snapshot = createActiveStreamSnapshot({
        sessionId: effectiveSessionId,
        taskId: args.taskId,
        prompt: args.prompt,
        model: args.model,
        workspaceDir: effectiveWorkspaceDir
      });

      try {
        return await client.runTask({
          taskId: args.taskId,
          prompt: args.prompt,
          sessionId: effectiveSessionId,
          model: args.model,
          workspaceDir: effectiveWorkspaceDir,
          extraWorkspaceDirs,
          taskNoteId: args.taskNoteId,
          gtdContext,
          thinking_level: args.thinking_level,
          mode: args.mode,
          attachments: args.attachments,
          // This pane is the visual chat: `ArtifactMermaidViewer` draws a
          // ` ```mermaid ` fence, so the daemon may ask for one.
          renderDiagrams: true,
          onEvent: (event) => {
            accumulateStreamEvent(snapshot, event);
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
      } finally {
        finishActiveStream(effectiveSessionId, args.taskId);
      }
    }
  );

  safeHandle("thunder:chat:getActiveStream", async (_event, args: { sessionId: string }) => {
    return getActiveStream(args.sessionId);
  });

  safeHandle("thunder:chat:cancelTask", async (_event, args: { taskId: string }) => {
    return getThunderClient().cancelTask(args.taskId);
  });

  safeHandle(
    "thunder:chat:answerQuestion",
    async (
      _event,
      args: {
        questionId: string;
        sessionId?: string;
        answers?: Record<string, string>;
        cancelled?: boolean;
      }
    ) => {
      // Answering ends the park: the buffered run must stop offering the
      // question, so a renderer that remounts mid-run cannot re-dock it.
      if (args.sessionId) dropPendingQuestion(args.sessionId, args.questionId);
      return getThunderClient().answerQuestion(args);
    }
  );

  safeHandle("thunder:chat:pauseTask", async (_event, args: { taskId: string }) => {
    return getThunderClient().pauseTask(args.taskId);
  });

  safeHandle("thunder:chat:resumeTask", async (_event, args: { taskId: string }) => {
    return getThunderClient().resumeTask(args.taskId);
  });

  safeHandle(
    "thunder:chat:steerTask",
    async (
      _event,
      args: {
        taskId: string;
        message: string;
        behavior: "steer" | "follow_up";
        attachments?: import("@agent-resume/core").ThunderImageAttachment[];
      }
    ) => {
      return getThunderClient().steerTask(
        args.taskId,
        args.message,
        args.behavior,
        args.attachments
      );
    }
  );

  safeHandle("thunder:chat:clearTaskQueue", async (_event, args: { taskId: string }) => {
    return getThunderClient().clearTaskQueue(args.taskId);
  });

  safeHandle(
    "thunder:chat:getPermissionState",
    async (_event, args: { sessionId: string }) => {
      return getThunderClient().getPermissionState(args.sessionId);
    }
  );

  safeHandle(
    "thunder:chat:setMode",
    async (
      _event,
      args: { sessionId: string; mode: import("@agent-resume/core").ThunderPermissionMode }
    ) => {
      return getThunderClient().setMode(args.sessionId, args.mode);
    }
  );

}
