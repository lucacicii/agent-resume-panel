/**
 * Agent status vocabulary shared by main, preload, and the renderer.
 *
 * The daemon speaks the same shapes over its socket (see
 * `main/agentStatus/types.ts` for the wire protocol), so this module is the one
 * place where "what state is this pane in" is defined.
 */

/** Bumped whenever the daemon wire protocol changes shape. */
export const AGENT_STATUS_API_VERSION = 1;

/**
 * Agents the app can manage a session for (see `buildResumeCommand`), plus
 * `unknown` for a pane whose process we could not name.
 */
export type AgentKind =
  | "claude"
  | "codex"
  | "pi"
  | "opencode"
  | "grok"
  | "cursor"
  | "agy"
  | "prime"
  | "unknown";

/**
 * What a pane is doing right now.
 *
 * `unknown` is reserved for panes whose agent has not been identified yet; the
 * fail-safe for "no evidence at all" is `idle`, because a false "waiting for
 * you" costs more than a missed cue.
 */
export type AgentState = "idle" | "working" | "blocked" | "unknown";

/** Which layer produced a verdict, in descending order of trust. */
export type DetectionSource = "native" | "osc" | "screen" | "process" | "activity" | "fallback";

/**
 * Which layer owns a pane.
 *
 * Once an agent reports through installed hooks or a status sequence the pane
 * becomes `native` and screen rules stop running for it, so a pane never has
 * two sources of truth.
 */
export type PaneAuthority = "native" | "screen";

/** Settled status for one pane. */
export type PaneStatus = {
  paneId: number;
  sessionKey?: string;
  agent: AgentKind;
  state: AgentState;
  authority: PaneAuthority;
  source: DetectionSource;
  /** Rule that produced the verdict, once the rule engine lands (stage 4). */
  matchedRule?: { id: string; priority: number; region: string };
  updatedAt: number;
};

/** Full status snapshot, pushed to subscribers and returned by `status.snapshot`. */
export type StatusSnapshot = {
  apiVersion: number;
  generatedAt: number;
  byPaneId: Record<string, PaneStatus>;
  bySessionKey: Record<string, PaneStatus>;
};

/** Why a pane settled the way it did, for diagnostics. */
export type DetectionExplain = {
  paneId: number;
  sessionKey?: string;
  agent: AgentKind;
  state: AgentState;
  authority: PaneAuthority;
  source: DetectionSource;
  matchedRule?: { id: string; priority: number; region: string };
  /** Human-readable reason for the current verdict. */
  reason?: string;
  updatedAt: number;
};

/** Response to the daemon handshake. */
export type HelloResult = {
  apiVersion: number;
  appVersion: string;
  pid: number;
  startedAt: number;
  paneCount: number;
  subscriberCount: number;
};
