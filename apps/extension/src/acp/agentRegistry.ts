import { AcpAgentLaunchConfig, AcpAgentProvider } from "./types";

export const ACP_AGENT_OPTIONS: Array<{
  label: string;
  description: string;
  provider: AcpAgentProvider;
}> = [
  { label: "$(hubot) Codex", description: "ACP via codex-acp", provider: "codex" },
  { label: "$(comment-discussion) Claude", description: "ACP via claude-agent-acp", provider: "claude" },
  { label: "$(rocket) Grok Build", description: "ACP via Grok agent stdio", provider: "grok" },
  { label: "$(terminal) OpenCode", description: "ACP via opencode acp", provider: "opencode" },
  { label: "$(symbol-method) Pi", description: "ACP via pi-acp", provider: "pi" },
  { label: "$(sparkle) Prime Agent", description: "ACP via prime-agent", provider: "prime" }
];

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
