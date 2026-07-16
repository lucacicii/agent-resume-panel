import { t } from "../i18n";
import { AcpAgentProvider } from "../acp/types";
import { HandoffDeliveryChannel, HandoffSource, HandoffTargetProvider } from "./types";

const HANDOFF_TARGET_LABEL_KEYS: Record<HandoffTargetProvider, string> = {
  codex: "menu.handoff.targetCodex",
  claude: "menu.handoff.targetClaude",
  agy: "menu.handoff.targetAgy",
  grok: "menu.handoff.targetGrok",
  opencode: "menu.handoff.targetOpenCode",
  pi: "menu.handoff.targetPi"
};

export interface HandoffTargetMeta {
  provider: HandoffTargetProvider;
  supportsAcp: boolean;
  supportsCli: boolean;
}

export function getHandoffTargetLabel(provider: HandoffTargetProvider): string {
  return t(HANDOFF_TARGET_LABEL_KEYS[provider]);
}

export const HANDOFF_TARGET_META: Record<HandoffTargetProvider, HandoffTargetMeta> = {
  codex: { provider: "codex", supportsAcp: true, supportsCli: true },
  claude: { provider: "claude", supportsAcp: true, supportsCli: true },
  agy: { provider: "agy", supportsAcp: false, supportsCli: true },
  grok: { provider: "grok", supportsAcp: true, supportsCli: true },
  opencode: { provider: "opencode", supportsAcp: true, supportsCli: true },
  pi: { provider: "pi", supportsAcp: true, supportsCli: true }
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