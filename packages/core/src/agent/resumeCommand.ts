import { AgentProvider, AgentSession } from "../catalog/types";

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

/** Resume CLI command for a catalog session (ported from extension terminal/commandBuilder). */
export function buildResumeCommand(session: Pick<AgentSession, "provider" | "id" | "projectPath" | "title">): string {
  if (session.provider === "codex") {
    return `codex resume --cd ${shellQuote(session.projectPath)} ${shellQuote(session.id)}`;
  }
  if (session.provider === "agy") {
    return `agy --conversation ${shellQuote(session.id)}`;
  }
  if (session.provider === "grok") {
    return `grok --cwd ${shellQuote(session.projectPath)} --resume ${shellQuote(session.id)}`;
  }
  if (session.provider === "alma") {
    // Alma activate is app-specific; provide a descriptive fallback
    const title = session.title?.trim() || session.id;
    return `# Alma: open thread ${shellQuote(session.id)} (${title}) in Alma app`;
  }
  if (session.provider === "opencode") {
    return `opencode --session ${shellQuote(session.id)}`;
  }
  if (session.provider === "pi") {
    return `pi --session ${shellQuote(session.id)}`;
  }
  if (session.provider === "chat") {
    return `# ACP chat session ${shellQuote(session.id)} — resume from Agent Resume / ACP panel`;
  }

  return `claude --resume ${shellQuote(session.id)}`;
}

export function buildResumeCommandFromRef(input: {
  provider: AgentProvider;
  id: string;
  projectPath: string;
  title?: string;
}): string {
  return buildResumeCommand({
    provider: input.provider,
    id: input.id,
    projectPath: input.projectPath,
    title: input.title || input.id
  });
}
