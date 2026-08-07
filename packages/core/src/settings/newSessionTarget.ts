import type { AgentProvider } from "../catalog/types";
import type { AcpAgentProvider, WorkbenchNewSessionTarget } from "./types";
import { ACP_AGENT_PROVIDERS } from "./types";

const CLI_PROVIDERS = new Set<string>([
  "codex",
  "claude",
  "grok",
  "agy",
  "opencode",
  "pi",
  "prime",
  "cursor",
  "chat"
]);

const ACP_PROVIDERS = new Set<string>(ACP_AGENT_PROVIDERS);

export type ParsedWorkbenchNewSessionTarget =
  | { channel: "cli"; provider: AgentProvider }
  | { channel: "acp"; provider: AcpAgentProvider };

export function formatCliNewSessionTarget(provider: AgentProvider): WorkbenchNewSessionTarget {
  return `cli:${provider}`;
}

export function formatAcpNewSessionTarget(provider: AcpAgentProvider): WorkbenchNewSessionTarget {
  return `acp:${provider}`;
}

/**
 * Parse `cli:codex` / `acp:claude`. Also accepts bare provider ids as legacy CLI.
 */
export function parseWorkbenchNewSessionTarget(
  value: string | undefined | null,
  legacyProvider?: AgentProvider | string | null
): ParsedWorkbenchNewSessionTarget {
  const raw = String(value ?? "").trim();
  if (raw) {
    const colon = raw.indexOf(":");
    if (colon > 0) {
      const channel = raw.slice(0, colon);
      const provider = raw.slice(colon + 1);
      if (channel === "acp" && ACP_PROVIDERS.has(provider)) {
        return { channel: "acp", provider: provider as AcpAgentProvider };
      }
      if (channel === "cli" && CLI_PROVIDERS.has(provider)) {
        return { channel: "cli", provider: provider as AgentProvider };
      }
    }
    if (CLI_PROVIDERS.has(raw)) {
      return { channel: "cli", provider: raw as AgentProvider };
    }
  }

  const legacy = String(legacyProvider ?? "codex").trim();
  if (CLI_PROVIDERS.has(legacy)) {
    return { channel: "cli", provider: legacy as AgentProvider };
  }
  return { channel: "cli", provider: "codex" };
}

export function isAcpAgentProvider(value: string | undefined | null): value is AcpAgentProvider {
  return Boolean(value && ACP_PROVIDERS.has(value));
}
