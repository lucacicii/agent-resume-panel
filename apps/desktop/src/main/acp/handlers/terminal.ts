import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

interface TerminalEntry {
  process: ChildProcessWithoutNullStreams;
  output: string;
  exitCode: number | null;
  waiters: Array<(code: number) => void>;
}

const terminals = new Map<string, TerminalEntry>();
const OUTPUT_LIMIT = 200_000;

function appendOutput(entry: TerminalEntry, value: string): void {
  entry.output = (entry.output + value).slice(-OUTPUT_LIMIT);
}

function finishTerminal(entry: TerminalEntry, exitCode: number): void {
  if (entry.exitCode != null) return;
  entry.exitCode = exitCode;
  for (const wait of entry.waiters) wait(exitCode);
  entry.waiters = [];
}

function normalizeTerminalLaunch(command: string, args: string[]): { command: string; args: string[] } {
  // Grok Build ACP currently sends this shell invocation as one command string
  // rather than ACP's command + args shape. Keep the compatibility narrowly scoped.
  if (!args.length && /^\/bin\/bash\s+-lc\s+\S/.test(command)) {
    return { command: "/bin/bash", args: ["-lc", command] };
  }
  return { command, args };
}

export async function createTerminal(params: {
  command: string;
  args?: string[];
  cwd?: string | null;
}): Promise<{ terminalId: string }> {
  const terminalId = `acp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const launch = normalizeTerminalLaunch(params.command, params.args ?? []);
  const child = spawn(launch.command, launch.args, {
    cwd: params.cwd || undefined,
    shell: false,
    env: process.env
  });
  const entry: TerminalEntry = {
    process: child,
    output: "",
    exitCode: null,
    waiters: []
  };
  child.stdout.on("data", (chunk: Buffer) => {
    appendOutput(entry, chunk.toString());
  });
  child.stderr.on("data", (chunk: Buffer) => {
    appendOutput(entry, chunk.toString());
  });
  child.on("error", (error: Error) => {
    appendOutput(entry, `Failed to start terminal: ${error.message}\n`);
    finishTerminal(entry, 127);
  });
  child.on("exit", (code) => {
    finishTerminal(entry, code ?? 0);
  });
  terminals.set(terminalId, entry);
  return { terminalId };
}

export async function terminalOutput(params: {
  terminalId: string;
}): Promise<{ output: string; truncated: boolean }> {
  const entry = terminals.get(params.terminalId);
  if (!entry) return { output: "", truncated: false };
  const truncated = entry.output.length >= OUTPUT_LIMIT;
  return { output: entry.output, truncated };
}

export async function releaseTerminal(params: { terminalId: string }): Promise<Record<string, never>> {
  const entry = terminals.get(params.terminalId);
  if (entry) {
    try {
      entry.process.kill();
    } catch {
      // ignore
    }
    terminals.delete(params.terminalId);
  }
  return {};
}

export async function waitForTerminalExit(params: { terminalId: string }): Promise<{ exitCode: number }> {
  const entry = terminals.get(params.terminalId);
  if (!entry) return { exitCode: 0 };
  if (entry.exitCode != null) return { exitCode: entry.exitCode };
  const exitCode = await new Promise<number>((resolve) => {
    entry.waiters.push(resolve);
  });
  return { exitCode };
}

export async function killTerminal(params: { terminalId: string }): Promise<Record<string, never>> {
  return releaseTerminal(params);
}
