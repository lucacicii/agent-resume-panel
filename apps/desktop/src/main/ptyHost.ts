import { BrowserWindow } from "electron";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as pty from "node-pty";
import { expandHome } from "@agent-resume/core";
import {
  checkoutGitBranch,
  listGitBranchesWithNested,
  queryGitInfoWithNested,
  type GitNestedScanOptions
} from "./gitNestedScan";
import { safeHandle } from "./ipcUtils";
import { ensureUtf8TerminalEnv } from "./terminalEnv";

interface PtySession {
  pty: pty.IPty;
  respawnOnExit: boolean;
  lastSpawnCwd: string;
  lastCols: number;
  lastRows: number;
  shell: string;
  startedAt: number;
  attached: boolean;
  replayChunks: string[];
  replayBytes: number;
  pendingForward: string[];
  pendingForwardBytes: number;
  flushTimer: NodeJS.Timeout | null;
}

/** Tail of PTY output kept while xterm is unmounted. Always drain onData. */
export const PTY_REPLAY_LIMIT = 256 * 1024;
/** Soft cap on concurrent PTY sessions. Spawn still succeeds. */
export const PTY_SOFT_LIMIT = 12;
const FORWARD_FLUSH_MS = 16;
const FORWARD_FLUSH_BYTES = 64 * 1024;

const ptySessions = new Map<number, PtySession>();
let nextTerminalId = 0;
let materializedIntegrationScript: string | null | undefined;
let warnedSoftLimit = false;

function appendReplay(session: PtySession, data: string): void {
  if (!data) return;
  session.replayChunks.push(data);
  session.replayBytes += data.length;
  while (session.replayBytes > PTY_REPLAY_LIMIT && session.replayChunks.length > 1) {
    const first = session.replayChunks.shift();
    if (first) session.replayBytes -= first.length;
  }
  if (session.replayBytes > PTY_REPLAY_LIMIT && session.replayChunks.length === 1) {
    const last = session.replayChunks[0] || "";
    session.replayChunks[0] = last.slice(-PTY_REPLAY_LIMIT);
    session.replayBytes = session.replayChunks[0].length;
  }
}

function replayText(session: PtySession): string {
  return session.replayChunks.join("");
}

function createPtySession(
  ptyInstance: pty.IPty,
  cwd: string,
  cols: number,
  rows: number,
  shell: string,
  attached: boolean
): PtySession {
  return {
    pty: ptyInstance,
    respawnOnExit: true,
    lastSpawnCwd: cwd,
    lastCols: cols,
    lastRows: rows,
    shell,
    startedAt: Date.now(),
    attached,
    replayChunks: [],
    replayBytes: 0,
    pendingForward: [],
    pendingForwardBytes: 0,
    flushTimer: null
  };
}

function clearForwardQueue(session: PtySession): void {
  if (session.flushTimer) {
    clearTimeout(session.flushTimer);
    session.flushTimer = null;
  }
  session.pendingForward = [];
  session.pendingForwardBytes = 0;
}

function flushForward(id: number, win: BrowserWindow | null): void {
  const session = ptySessions.get(id);
  if (!session) return;
  session.flushTimer = null;
  if (!session.attached || !session.pendingForward.length) {
    session.pendingForward = [];
    session.pendingForwardBytes = 0;
    return;
  }
  const data = session.pendingForward.join("");
  session.pendingForward = [];
  session.pendingForwardBytes = 0;
  if (win && !win.isDestroyed()) {
    win.webContents.send("terminal:data", { id, data });
  }
}

function queueForward(id: number, data: string, win: BrowserWindow | null): void {
  const session = ptySessions.get(id);
  if (!session || !session.attached || !data) return;
  session.pendingForward.push(data);
  session.pendingForwardBytes += data.length;
  if (session.pendingForwardBytes >= FORWARD_FLUSH_BYTES) {
    flushForward(id, win);
    return;
  }
  if (!session.flushTimer) {
    session.flushTimer = setTimeout(() => flushForward(id, win), FORWARD_FLUSH_MS);
    session.flushTimer.unref?.();
  }
}

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

function shellKind(shell: string): "zsh" | "bash" | "other" {
  const base = path.basename(shell).toLowerCase();
  if (base.includes("zsh")) return "zsh";
  if (base.includes("bash")) return "bash";
  return "other";
}

function ensureZdotDir(integrationScript: string): string {
  const dir = path.join(os.tmpdir(), "agent-resume-zdot");
  fs.mkdirSync(dir, { recursive: true });
  const homeZshrc = path.join(os.homedir(), ".zshrc");
  const content = [
    "# Generated by Agent Resume — embedded terminal cwd integration",
    `[ -f "${integrationScript}" ] && . "${integrationScript}"`,
    `[ -f "${homeZshrc}" ] && . "${homeZshrc}"`
  ].join("\n");
  fs.writeFileSync(path.join(dir, ".zshrc"), `${content}\n`, "utf8");
  return dir;
}

function materializeIntegrationScript(sourcePath: string): string | null {
  if (materializedIntegrationScript !== undefined) return materializedIntegrationScript;

  const destinationDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "agent-resume-shell-integration-")
  );
  try {
    fs.chmodSync(destinationDir, 0o700);
    const sourceDir = path.dirname(sourcePath);
    for (const name of ["integration.sh", "zsh.sh", "bash.sh"]) {
      const source = path.join(sourceDir, name);
      const destination = path.join(destinationDir, name);
      fs.writeFileSync(destination, fs.readFileSync(source), { mode: 0o600 });
      fs.chmodSync(destination, 0o600);
    }
    materializedIntegrationScript = path.join(destinationDir, "integration.sh");
    return materializedIntegrationScript;
  } catch (error) {
    fs.rmSync(destinationDir, { recursive: true, force: true });
    materializedIntegrationScript = null;
    console.warn("terminal shell integration could not be materialized:", error);
    return null;
  }
}

function resolveIntegrationScript(): string | null {
  if (process.platform !== "darwin" && process.platform !== "linux") return null;
  const candidates = [
    path.join(__dirname, "shellIntegration", "integration.sh"),
    path.join(__dirname, "..", "main", "shellIntegration", "integration.sh"),
    path.join(__dirname, "..", "..", "src", "main", "shellIntegration", "integration.sh")
  ];
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;

    // Electron can access files inside app.asar, but the spawned shell cannot.
    if (candidate.includes(`${path.sep}app.asar${path.sep}`)) {
      return materializeIntegrationScript(candidate);
    }
    return candidate;
  }
  return null;
}

function envWithPath(integrationScript: string | null, shell: string): Record<string, string> {
  // Strip undefined env values so node-pty always receives a clean string map.
  const raw: Record<string, string | undefined> = { ...process.env };
  const env = ensureUtf8TerminalEnv(raw) as Record<string, string>;
  for (const key of Object.keys(env)) {
    if (env[key] === undefined || env[key] === null) {
      delete env[key];
    }
  }
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
  if (integrationScript) {
    env.AGENT_RESUME_SHELL_INTEGRATION = integrationScript;
    env.TERM_PROGRAM = "AgentResume";
    if (shellKind(shell) === "zsh") {
      env.ZDOTDIR = ensureZdotDir(integrationScript);
    }
  }
  return env;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function buildShellLaunchArgs(
  shell: string,
  integrationScript: string | null,
  command?: string
): string[] {
  const quotedShell = shellQuote(shell);
  const cmd = command?.trim();
  const kind = shellKind(shell);

  if (integrationScript) {
    const quotedIntegration = shellQuote(integrationScript);
    if (cmd) {
      if (kind === "zsh") {
        // ZDOTDIR in env reloads integration after exec.
        return ["-ilc", `source ${quotedIntegration}; ${cmd}; exec ${quotedShell} -il`];
      }
      if (kind === "bash") {
        return [
          "-ic",
          `source ${quotedIntegration}; ${cmd}; exec ${quotedShell} -i --init-file ${quotedIntegration}`
        ];
      }
      return ["-ic", `source ${quotedIntegration}; ${cmd}; exec ${quotedShell} -i`];
    }

    // Interactive shells must not use -c (would exit immediately and respawn forever).
    if (kind === "bash") {
      return ["-i", "--init-file", integrationScript];
    }
    if (kind === "zsh") {
      return ["-il"];
    }
    return [];
  }

  if (cmd) {
    return ["-ic", `${cmd}; exec ${quotedShell}`];
  }
  return [];
}

function spawnPty(
  shell: string,
  cwd: string,
  cols: number,
  rows: number,
  command?: string
): pty.IPty {
  const integrationScript = resolveIntegrationScript();
  const env = envWithPath(integrationScript, shell);
  const args = buildShellLaunchArgs(shell, integrationScript, command);
  return pty.spawn(shell, args, {
    name: "xterm-256color",
    cols,
    rows,
    cwd,
    env
  });
}

function attachPtyHandlers(
  ptyInstance: pty.IPty,
  id: number,
  win: BrowserWindow | null
): void {
  ptyInstance.onData((data) => {
    const session = ptySessions.get(id);
    if (!session) return;
    // Always drain. Pause means "don't forward to xterm", never "stop reading".
    appendReplay(session, data);
    if (session.attached) queueForward(id, data, win);
  });
  ptyInstance.onExit(() => {
    const session = ptySessions.get(id);
    if (!session) return;

    const { respawnOnExit, lastSpawnCwd, lastCols, lastRows, shell, startedAt, attached } = session;
    ptySessions.delete(id);

    const livedMs = Date.now() - startedAt;
    if (respawnOnExit && lastSpawnCwd && livedMs >= 400) {
      try {
        const newPty = spawnPty(shell, lastSpawnCwd, lastCols, lastRows);
        const next = createPtySession(newPty, lastSpawnCwd, lastCols, lastRows, shell, attached);
        ptySessions.set(id, next);
        attachPtyHandlers(newPty, id, win);
        if (attached && win && !win.isDestroyed()) {
          win.webContents.send("terminal:respawned", { id });
        }
        return;
      } catch (error) {
        console.warn("terminal respawn failed:", error);
      }
    } else if (respawnOnExit && livedMs < 400) {
      console.warn(`terminal ${id} exited too quickly (${livedMs}ms); skipping respawn`);
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
  clearForwardQueue(session);
  try {
    session.pty.kill();
  } catch {
    // ignore
  }
  ptySessions.delete(id);
  if (ptySessions.size < PTY_SOFT_LIMIT) warnedSoftLimit = false;
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

      let ptyInstance: pty.IPty;
      try {
        ptyInstance = spawnPty(shell, cwd, cols, rows, args.command);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(`无法启动终端 (shell=${shell}, cwd=${cwd}): ${detail}`);
      }

      // Start detached so boot output lands in the replay buffer until xterm attaches.
      ptySessions.set(id, createPtySession(ptyInstance, cwd, cols, rows, shell, false));
      attachPtyHandlers(ptyInstance, id, win);
      const softLimitReached = ptySessions.size >= PTY_SOFT_LIMIT;
      const warnSoftLimit = softLimitReached && !warnedSoftLimit;
      if (warnSoftLimit) warnedSoftLimit = true;

      return { id, count: ptySessions.size, softLimit: PTY_SOFT_LIMIT, warnSoftLimit };
    }
  );

  safeHandle("terminal:attach", (_event, args: { id: number }) => {
    const session = ptySessions.get(Math.floor(args.id));
    if (!session) return { ok: false as const, replay: "" };
    session.attached = true;
    const replay = replayText(session);
    session.replayChunks = replay ? [replay] : [];
    session.replayBytes = replay.length;
    return { ok: true as const, replay };
  });

  safeHandle("terminal:detach", (_event, args: { id: number }) => {
    const session = ptySessions.get(Math.floor(args.id));
    if (session) {
      flushForward(Math.floor(args.id), getWindow());
      session.attached = false;
      clearForwardQueue(session);
    }
    return { ok: true };
  });

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

  safeHandle(
    "terminal:gitInfo",
    async (_event, args: { cwd: string; nestedScan?: GitNestedScanOptions }) => {
      const cwd = resolveCwd(args.cwd);
      return queryGitInfoWithNested(cwd, args.nestedScan);
    }
  );

  safeHandle(
    "terminal:gitBranches",
    async (_event, args: { cwd: string; nestedScan?: GitNestedScanOptions }) => {
      const cwd = resolveCwd(args.cwd);
      return listGitBranchesWithNested(cwd, args.nestedScan);
    }
  );

  safeHandle(
    "terminal:gitCheckout",
    async (_event, args: { cwd: string; branch: string; remote?: string; repoRoot?: string }) => {
      const cwd = resolveCwd(args.cwd);
      const info = await queryGitInfoWithNested(cwd);
      if (info.mode === "none") {
        throw new Error("当前目录不是 Git 仓库");
      }
      if (info.mode === "nested" && !args.repoRoot?.trim()) {
        throw new Error("请指定要切换分支的仓库");
      }
      const targetRoot = args.repoRoot?.trim() ? resolveCwd(args.repoRoot) : info.repoRoot || cwd;
      await checkoutGitBranch(targetRoot, args.branch, args.remote);
      const refreshed = await queryGitInfoWithNested(targetRoot);
      return { branch: refreshed.branch, repoRoot: targetRoot };
    }
  );
}

export function destroyPtyOnQuit(): void {
  for (const id of [...ptySessions.keys()]) {
    destroyPtyById(id);
  }
}
