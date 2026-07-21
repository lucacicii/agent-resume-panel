import { AgentProvider, AgentSession } from "../history";

export function buildResumeCommand(session: AgentSession): string {
  if (session.provider === "codex") {
    return `codex resume --cd ${shellQuote(session.projectPath)} ${shellQuote(session.id)}`;
  }
  if (session.provider === "agy") {
    return `agy --conversation ${shellQuote(session.id)}`;
  }
  if (session.provider === "grok") {
    return `grok --cwd ${shellQuote(session.projectPath)} --resume ${shellQuote(session.id)}`;
  }
  if (session.provider === "opencode") {
    return `opencode --session ${shellQuote(session.id)}`;
  }
  if (session.provider === "pi") {
    return `pi --session ${shellQuote(session.id)}`;
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
  if (provider === "grok") {
    return `grok --cwd ${shellQuote(projectPath)}`;
  }
  if (provider === "opencode") {
    return `opencode ${shellQuote(projectPath)}`;
  }
  if (provider === "pi") {
    return "pi";
  }

  return "claude";
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
