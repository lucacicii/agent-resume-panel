/**
 * Command lines the extension types into a user's terminal.
 *
 * VS Code owns the terminal, so the shell is whatever the user configured
 * (PowerShell and cmd on Windows, zsh/bash elsewhere). The quoting therefore
 * has to come from the platform layer rather than from a private POSIX copy.
 */

import { defaultShellKind, joinForShell } from "@agent-resume/core";
import { AgentProvider, AgentSession } from "../history";

/** Resume runs in the assigned project (user-move aware); providers restore by session id. */
export function buildResumeCommand(session: AgentSession): string {
  return joinForShell(buildResumeArgv(session), defaultShellKind());
}

export function buildResumeArgv(session: AgentSession): string[] {
  const cwd = session.projectPath;
  switch (session.provider) {
    case "codex":
      return ["codex", "resume", "--cd", cwd, session.id];
    case "agy":
      return ["agy", "--conversation", session.id];
    case "grok":
      return ["grok", "--cwd", cwd, "--resume", session.id];
    case "opencode":
      return ["opencode", "--session", session.id];
    case "pi":
      return ["pi", "--session", session.id];
    case "prime":
      return ["prime-agent", "--resume", session.id];
    case "omp":
      return ["omp", "-r", session.id];
    case "cursor":
      return ["cursor-agent", "--workspace", cwd, "--resume", session.id];
    case "cursor-ide":
      throw new Error("Cursor IDE chats cannot be resumed by command; open the project in Cursor instead.");
    default:
      return ["claude", "--resume", session.id];
  }
}

export function buildNewSessionCommand(provider: AgentProvider, projectPath: string): string {
  return joinForShell(buildNewSessionArgv(provider, projectPath), defaultShellKind());
}

export function buildNewSessionArgv(provider: AgentProvider, projectPath: string): string[] {
  switch (provider) {
    case "codex":
      return ["codex", "--cd", projectPath];
    case "agy":
      return ["agy"];
    case "grok":
      return ["grok", "--cwd", projectPath];
    case "opencode":
      return ["opencode", projectPath];
    case "pi":
      return ["pi"];
    case "prime":
      return ["prime-agent"];
    case "omp":
      return ["omp"];
    case "cursor":
      return ["cursor-agent", "--workspace", projectPath];
    case "cursor-ide":
    case "chat":
      throw new Error(`New terminal sessions are not supported for ${provider}.`);
    default:
      return ["claude"];
  }
}
