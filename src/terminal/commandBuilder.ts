import { AgentSession } from "../history";

export function buildResumeCommand(session: AgentSession): string {
  if (session.provider === "codex") {
    return `codex resume --cd ${shellQuote(session.projectPath)} ${shellQuote(session.id)}`;
  }

  return `claude --resume ${shellQuote(session.id)}`;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
