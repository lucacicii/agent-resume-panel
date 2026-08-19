import type { AcpAgentLaunchConfig, AcpAgentProvider } from "./types";

export const DEFAULT_ACP_AGENT_LAUNCH: Record<AcpAgentProvider, AcpAgentLaunchConfig> = {
  // Official adapter (supersedes @zed-industries/codex-acp). Emits standard ACP
  // modes + configOptions: model, reasoning_effort (thought_level), mode, etc.
  codex: { command: "npx", args: ["-y", "@agentclientprotocol/codex-acp@latest"] },
  claude: { command: "npx", args: ["-y", "@agentclientprotocol/claude-agent-acp@latest"] },
  grok: { command: "grok", args: ["agent", "stdio"] },
  opencode: { command: "npx", args: ["-y", "opencode-ai@latest", "acp"] },
  pi: { command: "npx", args: ["-y", "pi-acp"] },
  prime: { command: "prime-agent", args: ["--mode", "acp"] }
};
