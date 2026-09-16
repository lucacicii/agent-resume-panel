import { AgentProvider, AgentSession } from "../catalog/types";

/**
 * Resume runs in the session's assigned project (user-move aware). Providers
 * restore conversations by session id, so the working directory is where the
 * user expects the agent to keep working — the new project after a move.
 * Sessions are resumed in projectPath (effective), not the native path.
 *
 * `contextFile` (optional) is a work item's context block: it is appended to the
 * session's system prompt so a session that keeps a repository as its cwd still
 * knows which work item it serves.
 */
export function buildResumeCommand(session: AgentSession, contextFile?: string): string {
  return withSessionContext(resumeCommandFor(session), session.provider, contextFile);
}

function resumeCommandFor(session: AgentSession): string {
  const cwd = session.projectPath;
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

export function supportsNewSessionYoloMode(provider: AgentProvider): boolean {
  return (
    provider === "codex" ||
    provider === "claude" ||
    provider === "agy" ||
    provider === "grok" ||
    provider === "opencode" ||
    provider === "prime" ||
    provider === "cursor"
  );
}

export function buildNewSessionCommand(
  provider: AgentProvider,
  projectPath: string,
  mode: NewSessionExecutionMode,
  contextFile?: string
): string {
  return withSessionContext(newSessionCommandFor(provider, projectPath, mode), provider, contextFile);
}

function newSessionCommandFor(
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

/**
 * Flags that hand one session the contents of `file` as extra system prompt
 * text, so the work item's context travels with a session that runs in a
 * repository (no cwd change, nothing written into the repository).
 *
 * Only verified flags are listed. Providers without one return an empty string:
 * their sessions get the context through the working directory (the work item's
 * neutral workspace) or not at all.
 */
export function sessionContextFlags(provider: AgentProvider, file: string): string {
  if (provider === "codex") {
    // `-c` values are TOML when they parse, literal text otherwise. The block
    // starts with an HTML comment, so it always arrives as literal text.
    return `-c "developer_instructions=$(cat ${shellQuote(file)})"`;
  }
  if (provider === "claude" || provider === "pi" || provider === "prime") {
    return `--append-system-prompt "$(cat ${shellQuote(file)})"`;
  }
  return "";
}

/** Whether `sessionContextFlags` can deliver context for this provider. */
export function supportsSessionContext(provider: AgentProvider): boolean {
  return sessionContextFlags(provider, "x") !== "";
}

function withSessionContext(
  command: string,
  provider: AgentProvider,
  contextFile?: string
): string {
  const file = contextFile?.trim();
  if (!file) return command;
  const flags = sessionContextFlags(provider, file);
  return flags ? `${command} ${flags}` : command;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
