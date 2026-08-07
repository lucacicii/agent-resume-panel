import { AgentProvider } from "../../history";

const MAX_INLINE_HANDOFF_CHARS = 6000;

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function buildFileReferencePrompt(handoffFilePath: string): string {
  return `Read the session handoff file at ${handoffFilePath} and continue the work from the Next step section.`;
}

export function buildHandoffCliLaunchCommand(
  provider: AgentProvider,
  projectPath: string,
  composedMessage: string,
  handoffFilePath: string
): string {
  const useInline = composedMessage.length <= MAX_INLINE_HANDOFF_CHARS;
  const prompt = useInline ? composedMessage : buildFileReferencePrompt(handoffFilePath);

  switch (provider) {
    case "codex":
      return `codex --cd ${shellQuote(projectPath)} ${shellQuote(prompt)}`;
    case "grok":
      return `grok --cwd ${shellQuote(projectPath)} ${shellQuote(prompt)}`;
    case "claude":
      return `claude ${shellQuote(prompt)}`;
    case "opencode":
      return `opencode run ${shellQuote(prompt)}`;
    case "pi":
      if (useInline) {
        return `pi ${shellQuote(prompt)}`;
      }
      return `pi @${shellQuotePathForPi(handoffFilePath)}`;
    case "prime":
      if (useInline) {
        return `prime-agent ${shellQuote(prompt)}`;
      }
      return `prime-agent @${shellQuotePathForPi(handoffFilePath)}`;
    case "agy":
      return `agy --prompt-interactive ${shellQuote(prompt)}`;
    default:
      return `claude ${shellQuote(prompt)}`;
  }
}

function shellQuotePathForPi(filePath: string): string {
  if (/^[A-Za-z0-9_./-]+$/.test(filePath)) {
    return filePath;
  }
  return shellQuote(filePath).slice(1, -1);
}
