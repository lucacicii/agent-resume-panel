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
}
