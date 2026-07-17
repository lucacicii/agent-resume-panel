import { ipcMain } from "electron";

/** Replace an existing handler (safe for dev restarts / hot reload). */
export function safeHandle(
  channel: string,
  handler: Parameters<typeof ipcMain.handle>[1]
): void {
  ipcMain.removeHandler(channel);
  ipcMain.handle(channel, handler);
}