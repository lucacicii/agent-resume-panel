import { AgentProvider, AgentSession } from "../history";

export function buildResumeCommand(session: AgentSession): string {
  if (session.provider === "codex") {
    return `codex resume --cd ${shellQuote(session.projectPath)} ${shellQuote(session.id)}`;
  }

  return `claude --resume ${shellQuote(session.id)}`;
}

export function buildNewSessionCommand(provider: AgentProvider, projectPath: string): string {
  if (provider === "codex") {
    return `codex --cd ${shellQuote(projectPath)}`;
  }

  return "claude";
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
