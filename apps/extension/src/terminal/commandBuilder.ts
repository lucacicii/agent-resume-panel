import { AgentProvider, AgentSession } from "../history";

/** Resume must run in the provider's native cwd, not a user-reassigned display path. */
function resumeProjectPath(session: AgentSession): string {
  return session.nativeProjectPath?.trim() || session.projectPath;
}

export function buildResumeCommand(session: AgentSession): string {
  const cwd = resumeProjectPath(session);
  if (session.provider === "codex") {
    return `codex resume --cd ${shellQuote(cwd)} ${shellQuote(session.id)}`;
  }
  if (session.provider === "agy") {
    return `agy --conversation ${shellQuote(session.id)}`;
  }
  if (session.provider === "grok") {
    return `grok --cwd ${shellQuote(cwd)} --resume ${shellQuote(session.id)}`;
  }
  if (session.provider === "opencode") {
    return `opencode --session ${shellQuote(session.id)}`;
  }
  if (session.provider === "pi") {
    return `pi --session ${shellQuote(session.id)}`;
  }
  if (session.provider === "prime") {
    return `prime-agent --resume ${shellQuote(session.id)}`;
  }
  if (session.provider === "cursor") {
    return `cursor-agent --workspace ${shellQuote(cwd)} --resume ${shellQuote(session.id)}`;
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
  if (provider === "prime") {
    return "prime-agent";
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
