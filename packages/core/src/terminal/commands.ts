import { AgentProvider, AgentSession } from "../catalog/types";

/**
 * Resume/operations must run in the provider's native cwd (where agent data
 * lives), not a user-reassigned display path. Falls back to projectPath for
 * legacy rows without a native path.
 */
export function resumeProjectPath(session: AgentSession): string {
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

export type NewSessionExecutionMode = "standard" | "yolo";

export function buildNewSessionCommand(
  provider: AgentProvider,
  projectPath: string,
  mode: NewSessionExecutionMode
): string {
  if (mode === "yolo") {
    if (provider === "codex") {
      return `codex --cd ${shellQuote(projectPath)} --dangerously-bypass-approvals-and-sandbox`;
    }
    if (provider === "claude") {
      return "claude --dangerously-skip-permissions";
    }
    if (provider === "agy") {
      return "agy --dangerously-skip-permissions";
    }
    if (provider === "grok") {
      return `grok --cwd ${shellQuote(projectPath)} --permission-mode bypassPermissions --sandbox off`;
    }
    if (provider === "opencode") {
      return `opencode ${shellQuote(projectPath)} --auto`;
    }
    if (provider === "prime") {
      return "prime-agent --autonomous";
    }
    if (provider === "cursor") {
      return `cursor-agent --workspace ${shellQuote(projectPath)} --yolo --sandbox disabled --approve-mcps`;
    }
    throw new Error(`YOLO mode is not supported for provider: ${provider}.`);
  }

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
  if (provider === "cursor-ide") {
    throw new Error("Cursor IDE chats cannot be created from the terminal.");
  }

  return "claude";
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
