import { BrowserWindow } from "electron";
import * as pty from "node-pty";
import { safeHandle } from "./ipcUtils";

let activePty: pty.IPty | null = null;
let activeTerminalId = 0;

function destroyActivePty(): void {
  if (!activePty) return;
  try {
    activePty.kill();
  } catch {
    // ignore
  }
  activePty = null;
}

export function registerPtyIpc(getWindow: () => BrowserWindow | null): void {
  safeHandle(
    "terminal:spawn",
    async (
      _event,
      args: { cwd: string; command?: string; cols?: number; rows?: number }
    ) => {
      destroyActivePty();
      const shell = process.env.SHELL || "/bin/zsh";
      const cols = Math.max(2, Math.floor(args.cols || 80));
      const rows = Math.max(2, Math.floor(args.rows || 24));
      const cwd = args.cwd?.trim() || process.cwd();
      const env = { ...process.env } as Record<string, string>;

      if (args.command?.trim()) {
        activePty = pty.spawn(shell, ["-lc", args.command.trim()], {
          name: "xterm-256color",
          cols,
          rows,
          cwd,
          env
        });
      } else {
        activePty = pty.spawn(shell, [], {
          name: "xterm-256color",
          cols,
          rows,
          cwd,
          env
        });
      }

      const id = ++activeTerminalId;
      const win = getWindow();

      activePty.onData((data) => {
        if (win && !win.isDestroyed()) {
          win.webContents.send("terminal:data", { id, data });
        }
      });
      activePty.onExit(() => {
        if (win && !win.isDestroyed()) {
          win.webContents.send("terminal:exit", { id });
        }
        activePty = null;
      });

      return { id };
    }
  );

  safeHandle("terminal:input", (_event, args: { data: string }) => {
    activePty?.write(args.data);
    return { ok: true };
  });

  safeHandle("terminal:resize", (_event, args: { cols: number; rows: number }) => {
    const cols = Math.max(2, Math.floor(args.cols || 80));
    const rows = Math.max(2, Math.floor(args.rows || 24));
    activePty?.resize(cols, rows);
    return { ok: true };
  });

  safeHandle("terminal:destroy", () => {
    destroyActivePty();
    return { ok: true };
  });
}

export function destroyPtyOnQuit(): void {
  destroyActivePty();
}