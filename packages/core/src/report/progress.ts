import { AgentSession } from "../catalog/types";

export type DigestLevel = "daily" | "weekly" | "monthly";

export type DigestProgressPhase =
  | "start"
  | "ensure_summaries"
  | "session_start"
  | "session_done"
  | "session_skip"
  | "session_fail"
  | "digest"
  | "embed"
  | "complete"
  | "error";

export interface DigestProgressSession {
  provider: string;
  id: string;
  title: string;
}

export interface DigestProgressEvent {
  phase: DigestProgressPhase;
  level: DigestLevel;
  periodLabel: string;
  /** Local day YYYY-MM-DD when cascading daily digests (weekly/monthly runs). */
  dayKey?: string;
  /** Human-readable status line for UI. */
  message?: string;
  /** 1-based progress through sessions when ensuring summaries. */
  index?: number;
  total?: number;
  session?: DigestProgressSession;
}

export type DigestProgressCallback = (event: DigestProgressEvent) => void;

export function sessionProgressRef(session: AgentSession): DigestProgressSession {
  return {
    provider: session.provider,
    id: session.id,
    title: session.title
  };
}
