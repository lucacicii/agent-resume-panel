import { BrowserWindow } from "electron";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as pty from "node-pty";
import { expandHome } from "@agent-resume/core";
import { safeHandle } from "./ipcUtils";

let activePty: pty.IPty | null = null;
let activeTerminalId = 0;
let respawnOnExit = false;
let lastSpawnCwd = process.cwd();
let lastCols = 80;
let lastRows = 24;

function ensureSpawnHelperExecutable(): void {
  if (process.platform !== "darwin" && process.platform !== "linux") return;
  try {
    const entry = require.resolve("node-pty");
    const helperPath = path.resolve(
      path.dirname(entry),
      `../prebuilds/${process.platform}-${process.arch}/spawn-helper`
    );
    if (!fs.existsSync(helperPath)) return;
    const mode = fs.statSync(helperPath).mode;
    if ((mode & 0o111) === 0) {
      fs.chmodSync(helperPath, mode | 0o755);
    }
  } catch {
    // spawn will surface a descriptive error if helper is still unusable
  }
}

ensureSpawnHelperExecutable();

const FALLBACK_SHELLS = [
  "/bin/zsh",
  "/bin/bash",
  "/opt/homebrew/bin/zsh",
  "/usr/local/bin/zsh"
];

function isExecutable(filePath: string): boolean {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function findExecutableInPath(name: string, extraDirs: string[]): string | null {
  const dirs = new Set<string>();
  for (const dir of (process.env.PATH || "").split(path.delimiter)) {
    if (dir) dirs.add(dir);
  }
  for (const dir of extraDirs) {
    dirs.add(dir);
  }

  for (const dir of dirs) {
    const full = path.join(dir, name);
    if (isExecutable(full)) return full;
  }
  return null;
}

function resolveShell(): string {
  const candidate = process.env.SHELL?.trim() || "";
  if (candidate) {
    const expanded = expandHome(candidate);
    if (path.isAbsolute(expanded) && isExecutable(expanded)) {
      return expanded;
    }
    const fromPath = findExecutableInPath(path.basename(candidate), [
      "/opt/homebrew/bin",
      "/usr/local/bin",
      "/usr/bin",
      "/bin"
    ]);
    if (fromPath) return fromPath;
  }

  for (const shell of FALLBACK_SHELLS) {
    if (isExecutable(shell)) return shell;
  }

  return "/bin/zsh";
}

function resolveCwd(raw?: string): string {
  const cwd = expandHome(raw?.trim() || process.cwd());
  try {
    const stat = fs.statSync(cwd);
    if (!stat.isDirectory()) {
      throw new Error(`工作目录不是文件夹: ${cwd}`);
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      throw new Error(`工作目录不存在: ${cwd}`);
    }
    throw error;
  }
  return cwd;
}

function envWithPath(): Record<string, string> {
  const env = { ...process.env } as Record<string, string>;
  const home = os.homedir();
  const extra = [
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
    path.join(home, ".local/bin"),
    path.join(home, ".npm-global/bin")
  ];
  const merged = (env.PATH || "").split(path.delimiter).filter(Boolean);
  for (const dir of extra) {
    if (!merged.includes(dir) && fs.existsSync(dir)) {
      merged.push(dir);
    }
  }
  env.PATH = merged.join(path.delimiter);
  if (!env.HOME) env.HOME = home;
  if (!env.TERM) env.TERM = "xterm-256color";
  return env;
}

function spawnInteractivePty(
  shell: string,
  cwd: string,
  cols: number,
  rows: number
): pty.IPty {
  return pty.spawn(shell, [], {
    name: "xterm-256color",
    cols,
    rows,
    cwd,
    env: envWithPath()
  });
}

function attachPtyHandlers(
  ptyInstance: pty.IPty,
  id: number,
  shell: string,
  win: BrowserWindow | null
): void {
  ptyInstance.onData((data) => {
    if (win && !win.isDestroyed()) {
      win.webContents.send("terminal:data", { id, data });
    }
  });
  ptyInstance.onExit(() => {
    activePty = null;
    if (respawnOnExit && lastSpawnCwd) {
      try {
        activePty = spawnInteractivePty(shell, lastSpawnCwd, lastCols, lastRows);
        attachPtyHandlers(activePty, id, shell, win);
        if (win && !win.isDestroyed()) {
          win.webContents.send("terminal:respawned", { id });
        }
        return;
      } catch (error) {
        console.warn("terminal respawn failed:", error);
      }
    }
    if (win && !win.isDestroyed()) {
      win.webContents.send("terminal:exit", { id });
    }
  });
}

function destroyActivePty(): void {
  respawnOnExit = false;
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
      respawnOnExit = true;

      const shell = resolveShell();
      const cols = Math.max(2, Math.floor(args.cols || 80));
      const rows = Math.max(2, Math.floor(args.rows || 24));
      const cwd = resolveCwd(args.cwd);
      lastSpawnCwd = cwd;
      lastCols = cols;
      lastRows = rows;

      const spawnOpts = {
        name: "xterm-256color",
        cols,
        rows,
        cwd,
        env: envWithPath()
      };

      try {
        const command = args.command?.trim();
        if (command) {
          // Run resume/new command, then drop into an interactive shell so input keeps working.
          activePty = pty.spawn(shell, ["-lc", `${command}; exec ${shell} -l`], spawnOpts);
        } else {
          activePty = spawnInteractivePty(shell, cwd, cols, rows);
        }
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(`无法启动终端 (shell=${shell}, cwd=${cwd}): ${detail}`);
      }

      const id = ++activeTerminalId;
      const win = getWindow();
      attachPtyHandlers(activePty, id, shell, win);

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
    lastCols = cols;
    lastRows = rows;
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