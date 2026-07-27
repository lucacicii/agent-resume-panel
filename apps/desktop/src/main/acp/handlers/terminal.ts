import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

interface TerminalEntry {
  process: ChildProcessWithoutNullStreams;
  output: string;
  exitCode: number | null;
  waiters: Array<(code: number) => void>;
}

const terminals = new Map<string, TerminalEntry>();
const OUTPUT_LIMIT = 200_000;

export async function createTerminal(params: {
  command: string;
  args?: string[];
  cwd?: string | null;
}): Promise<{ terminalId: string }> {
  const terminalId = `acp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const child = spawn(params.command, params.args ?? [], {
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
    entry.output = (entry.output + chunk.toString()).slice(-OUTPUT_LIMIT);
  });
  child.stderr.on("data", (chunk: Buffer) => {
    entry.output = (entry.output + chunk.toString()).slice(-OUTPUT_LIMIT);
  });
  child.on("exit", (code) => {
    entry.exitCode = code ?? 0;
    for (const wait of entry.waiters) wait(entry.exitCode);
    entry.waiters = [];
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
