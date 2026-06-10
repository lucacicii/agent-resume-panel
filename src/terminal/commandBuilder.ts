import { AgentProvider, AgentSession } from "../history";

export function buildResumeCommand(session: AgentSession): string {
  if (session.provider === "codex") {
    return `codex resume --cd ${shellQuote(session.projectPath)} ${shellQuote(session.id)}`;
  }
  if (session.provider === "agy") {
    return `agy --conversation ${shellQuote(session.id)}`;
  }

  return `claude --resume ${shellQuote(session.id)}`;
}

export function buildNewSessionCommand(provider: AgentProvider, projectPath: string): string {
  if (provider === "codex") {
    return `codex --cd ${shellQuote(projectPath)}`;
  }
  if (provider === "agy") {
    return "agy";
  }

  return "claude";
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
