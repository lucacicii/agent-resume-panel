import { AcpAgentProvider } from "../acp/types";
import { HandoffDeliveryChannel, HandoffSource, HandoffTargetProvider } from "./types";

export interface HandoffTargetMeta {
  provider: HandoffTargetProvider;
  label: string;
  supportsAcp: boolean;
  supportsCli: boolean;
}

export const HANDOFF_TARGET_META: Record<HandoffTargetProvider, HandoffTargetMeta> = {
  codex: { provider: "codex", label: "Codex", supportsAcp: true, supportsCli: true },
  claude: { provider: "claude", label: "Claude Code", supportsAcp: true, supportsCli: true },
  agy: { provider: "agy", label: "Antigravity CLI", supportsAcp: false, supportsCli: true },
  grok: { provider: "grok", label: "Grok Build", supportsAcp: true, supportsCli: true },
  opencode: { provider: "opencode", label: "OpenCode", supportsAcp: true, supportsCli: true },
  pi: { provider: "pi", label: "Pi", supportsAcp: true, supportsCli: true }
};

export const CLI_HANDOFF_TARGETS: HandoffTargetProvider[] = [
  "codex",
  "claude",
  "agy",
  "grok",
  "opencode",
  "pi"
];

export const ACP_HANDOFF_TARGETS: AcpAgentProvider[] = ["codex", "claude", "grok", "opencode", "pi"];

export function isAcpHandoffTarget(provider: HandoffTargetProvider): provider is AcpAgentProvider {
  return provider !== "agy";
}

export function resolveDeliveryChannelForSource(
  source: HandoffSource,
  target: HandoffTargetProvider
): HandoffDeliveryChannel {
  if (source.kind === "acp") {
    return isAcpHandoffTarget(target) ? "acp" : "clipboard";
  }

  return HANDOFF_TARGET_META[target].supportsCli ? "cli" : "clipboard";
}

