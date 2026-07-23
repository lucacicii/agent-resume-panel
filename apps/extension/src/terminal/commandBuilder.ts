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
  if (session.provider === "cursor") {
    return `cursor-agent --workspace ${shellQuote(session.projectPath)} --resume ${shellQuote(session.id)}`;
  }
  if (session.provider === "cursor-ide") {
    throw new Error("Cursor IDE chats cannot be resumed by command; open the project in Cursor instead.");
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
  if (provider === "cursor") {
    return `cursor-agent --workspace ${shellQuote(projectPath)}`;
  }
  if (provider === "cursor-ide" || provider === "chat") {
    throw new Error(`New terminal sessions are not supported for ${provider}.`);
  }

  return "claude";
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
