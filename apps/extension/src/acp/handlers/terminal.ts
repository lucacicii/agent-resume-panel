import * as vscode from "vscode";

interface TerminalEntry {
  terminal: vscode.Terminal;
}

const terminals = new Map<string, TerminalEntry>();

export async function createTerminal(params: {
  command: string;
  args?: string[];
  cwd?: string | null;
}): Promise<{ terminalId: string }> {
  const terminalId = `acp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const terminal = vscode.window.createTerminal({
    name: `ACP Agent`,
    cwd: params.cwd ?? undefined
  });
  terminals.set(terminalId, { terminal });
  const shellCommand = [params.command, ...(params.args ?? [])].join(" ");
  terminal.show(true);
  terminal.sendText(shellCommand, true);
  return { terminalId };
}

export async function terminalOutput(_params: { terminalId: string }): Promise<{ output: string; truncated: boolean }> {
  return { output: "", truncated: false };
}

export async function releaseTerminal(params: { terminalId: string }): Promise<Record<string, never>> {
  const entry = terminals.get(params.terminalId);
  if (entry) {
    entry.terminal.dispose();
    terminals.delete(params.terminalId);
  }
  return {};
}

export async function waitForTerminalExit(_params: { terminalId: string }): Promise<{ exitCode: number }> {
  return { exitCode: 0 };
}

export async function killTerminal(params: { terminalId: string }): Promise<Record<string, never>> {
  return releaseTerminal(params);
}