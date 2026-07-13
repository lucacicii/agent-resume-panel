import { BrowserWindow } from "electron";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as pty from "node-pty";
import { expandHome } from "@agent-resume/core";
import { safeHandle } from "./ipcUtils";

interface PtySession {
  pty: pty.IPty;
  respawnOnExit: boolean;
  lastSpawnCwd: string;
  lastCols: number;
  lastRows: number;
  shell: string;
}

const ptySessions = new Map<number, PtySession>();
let nextTerminalId = 0;

function ensureSpawnHelperExecutable(): void {
  if (process.platform !== "darwin" && process.platform !== "linux") return;
  try {
    const entry = require.resolve("node-pty");
    const moduleRoot = path.resolve(path.dirname(entry), "..");
    const writableRoot = moduleRoot
      .replace("app.asar", "app.asar.unpacked")
      .replace("node_modules.asar", "node_modules.asar.unpacked");
    const helpers = [
      path.join(writableRoot, "build", "Release", "spawn-helper"),
      path.join(writableRoot, "build", "Debug", "spawn-helper")
    ];
    const prebuildsRoot = path.join(writableRoot, "prebuilds");
    if (fs.existsSync(prebuildsRoot)) {
      for (const dir of fs.readdirSync(prebuildsRoot, { withFileTypes: true })) {
        if (dir.isDirectory() && dir.name.startsWith(`${process.platform}-`)) {
          helpers.push(path.join(prebuildsRoot, dir.name, "spawn-helper"));
        }
      }
    }
    for (const helperPath of helpers) {
      if (!fs.existsSync(helperPath)) continue;
      const mode = fs.statSync(helperPath).mode;
      if ((mode & 0o111) === 0) {
        fs.chmodSync(helperPath, mode | 0o755);
      }
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

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function attachPtyHandlers(
  ptyInstance: pty.IPty,
  id: number,
  win: BrowserWindow | null
): void {
  ptyInstance.onData((data) => {
    if (win && !win.isDestroyed()) {
      win.webContents.send("terminal:data", { id, data });
    }
  });
  ptyInstance.onExit(() => {
    const session = ptySessions.get(id);
    if (!session) return;

    const { respawnOnExit, lastSpawnCwd, lastCols, lastRows, shell } = session;
    ptySessions.delete(id);

    if (respawnOnExit && lastSpawnCwd) {
      try {
        const newPty = spawnInteractivePty(shell, lastSpawnCwd, lastCols, lastRows);
        ptySessions.set(id, {
          pty: newPty,
          respawnOnExit: true,
          lastSpawnCwd,
          lastCols,
          lastRows,
          shell
        });
        attachPtyHandlers(newPty, id, win);
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

function destroyPtyById(id: number): void {
  const session = ptySessions.get(id);
  if (!session) return;
  session.respawnOnExit = false;
  try {
    session.pty.kill();
  } catch {
    // ignore
  }
  ptySessions.delete(id);
}

export function registerPtyIpc(getWindow: () => BrowserWindow | null): void {
  safeHandle(
    "terminal:spawn",
    async (
      _event,
      args: { cwd: string; command?: string; cols?: number; rows?: number }
    ) => {
      const shell = resolveShell();
      const cols = Math.max(2, Math.floor(args.cols || 80));
      const rows = Math.max(2, Math.floor(args.rows || 24));
      const cwd = resolveCwd(args.cwd);
      const id = ++nextTerminalId;
      const win = getWindow();

      const spawnOpts = {
        name: "xterm-256color",
        cols,
        rows,
        cwd,
        env: envWithPath()
      };

      let ptyInstance: pty.IPty;
      try {
        const command = args.command?.trim();
        if (command) {
          ptyInstance = pty.spawn(shell, ["-ic", `${command}; exec ${shellQuote(shell)}`], spawnOpts);
        } else {
          ptyInstance = spawnInteractivePty(shell, cwd, cols, rows);
        }
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(`无法启动终端 (shell=${shell}, cwd=${cwd}): ${detail}`);
      }

      ptySessions.set(id, {
        pty: ptyInstance,
        respawnOnExit: true,
        lastSpawnCwd: cwd,
        lastCols: cols,
        lastRows: rows,
        shell
      });
      attachPtyHandlers(ptyInstance, id, win);

      return { id };
    }
  );

  safeHandle("terminal:input", (_event, args: { id: number; data: string }) => {
    const session = ptySessions.get(Math.floor(args.id));
    session?.pty.write(args.data);
    return { ok: true };
  });

  safeHandle("terminal:resize", (_event, args: { id: number; cols: number; rows: number }) => {
    const id = Math.floor(args.id);
    const session = ptySessions.get(id);
    const cols = Math.max(2, Math.floor(args.cols || 80));
    const rows = Math.max(2, Math.floor(args.rows || 24));
    if (session) {
      session.lastCols = cols;
      session.lastRows = rows;
      session.pty.resize(cols, rows);
    }
    return { ok: true };
  });

  safeHandle("terminal:destroy", (_event, args: { id: number }) => {
    destroyPtyById(Math.floor(args.id));
    return { ok: true };
  });
}

export function destroyPtyOnQuit(): void {
  for (const id of [...ptySessions.keys()]) {
    destroyPtyById(id);
  }
}
