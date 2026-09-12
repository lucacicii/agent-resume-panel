/**
 * Agent status vocabulary shared by main, preload, and the renderer.
 *
 * The daemon speaks the same shapes over its socket (see
 * `main/agentStatus/types.ts` for the wire protocol), so this module is the one
 * place where "what state is this pane in" is defined.
 */

/**
 * Bumped whenever the daemon wire protocol changes shape.
 *
 * v2: the protocol gained `pane.screen` (diagnostics/capture).
 *
 * The version is what makes an app upgrade replace a daemon that is still
 * running with the previous build's behaviour.
 */
export const AGENT_STATUS_API_VERSION = 2;

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
  /** Rule that produced a screen verdict, when one did. */
  matchedRule?: { id: string; priority: number; region: string; manifest?: string };
  updatedAt: number;
};

/** Full status snapshot, pushed to subscribers and returned by `status.snapshot`. */
export type StatusSnapshot = {
  apiVersion: number;
  generatedAt: number;
  byPaneId: Record<string, PaneStatus>;
  bySessionKey: Record<string, PaneStatus>;
};

/** One rule's outcome, kept for `status.explain`. */
export type EvaluatedRule = {
  id: string;
  /** Manifest the rule was authored in (per-agent rules layer over the base). */
  manifest: string;
  priority: number;
  region: string;
  state: AgentState;
  matched: boolean;
  /** Why it did or did not match, in one line. */
  reason: string;
  evidence: {
    contains: string[];
    regex: string[];
    lineRegex: string[];
    /** Region text size, so an empty region is obvious in the output. */
    regionBytes: number;
  };
};

/** Why a pane settled the way it did, for diagnostics. */
export type DetectionExplain = {
  paneId: number;
  sessionKey?: string;
  agent: AgentKind;
  state: AgentState;
  authority: PaneAuthority;
  source: DetectionSource;
  matchedRule?: { id: string; priority: number; region: string; manifest?: string };
  /** Human-readable reason for the current verdict. */
  reason?: string;
  /** Every manifest layer consulted, in precedence order. */
  manifests?: { id: string; version: string; source: "bundled" | "override" }[];
  /** Set when a rule deliberately suppressed the screen (transcript viewer). */
  screenSkipped?: string;
  /** Every rule considered this tick, matched or not. */
  evaluated?: EvaluatedRule[];
  updatedAt: number;
};

/** What the engine saw for one pane, for capture and diagnostics tooling. */
export type PaneScreenDump = {
  paneId: number;
  agent: AgentKind;
  state: AgentState;
  source: DetectionSource;
  authority: PaneAuthority;
  matchedRule?: { id: string; priority: number; region: string; manifest?: string };
  reason?: string;
  /** The screen text the rules were evaluated against. */
  screenText: string;
  oscTitle: string;
  oscProgress: string;
  cursorHidden: boolean;
  toolRunning: boolean;
  /** Timestamp of the telemetry frame this dump came from. */
  at: number;
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
