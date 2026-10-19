import { joinForShell, shellQuoteFor, defaultShellKind, type ShellKind } from "@agent-resume/core";
import { AgentProvider } from "../../history";

const MAX_INLINE_HANDOFF_CHARS = 6000;

function buildFileReferencePrompt(handoffFilePath: string): string {
  return `Read the session handoff file at ${handoffFilePath} and continue the work from the Next step section.`;
}

/**
 * Command line for a handoff launch.
 *
 * `shell` is the terminal's shell: VS Code runs `sendText` through it, and on
 * Windows that is PowerShell or cmd rather than a POSIX shell.
 */
export function buildHandoffCliLaunchCommand(
  provider: AgentProvider,
  projectPath: string,
  composedMessage: string,
  handoffFilePath: string,
  shell: ShellKind = defaultShellKind()
): string {
  return joinForShell(buildHandoffCliLaunchArgv(provider, projectPath, composedMessage, handoffFilePath), shell);
}

export function buildHandoffCliLaunchArgv(
  provider: AgentProvider,
  projectPath: string,
  composedMessage: string,
  handoffFilePath: string
): string[] {
  const useInline = composedMessage.length <= MAX_INLINE_HANDOFF_CHARS;
  const prompt = useInline ? composedMessage : buildFileReferencePrompt(handoffFilePath);
  const fileRef = `@${handoffFilePath}`;

  switch (provider) {
    case "codex":
      return ["codex", "--cd", projectPath, prompt];
    case "grok":
      return ["grok", "--cwd", projectPath, prompt];
    case "claude":
      return ["claude", prompt];
    case "opencode":
      return ["opencode", "run", prompt];
    case "pi":
      return useInline ? ["pi", prompt] : ["pi", fileRef];
    case "prime":
      return useInline ? ["prime-agent", prompt] : ["prime-agent", fileRef];
    case "omp":
      return useInline ? ["omp", prompt] : ["omp", fileRef];
    case "agy":
      return ["agy", "--prompt-interactive", prompt];
    default:
      return ["claude", prompt];
  }
}

/** Path for a prompt the user is editing by hand (kept exported for callers). */
export function quotePathForShell(filePath: string, shell: ShellKind = defaultShellKind()): string {
  return shellQuoteFor(shell, filePath);
}
