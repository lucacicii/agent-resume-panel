import type { SessionDotStatus } from "./activeSessionDots";

/** Recent PTY output ⇒ treat as running. */
export const TUI_RUNNING_MS = 2_500;
/** Alternate-buffer silence before weak awaiting (best-effort). */
export const TUI_IDLE_AWAIT_MS = 10_000;
/** Consecutive positive text samples required before confirmed awaiting. */
export const TUI_TEXT_HIT_STREAK = 2;
/** Consecutive negative samples required to clear text-based awaiting. */
export const TUI_TEXT_MISS_STREAK = 2;

export type TuiDetectInput = {
  visibleText: string;
  lastOutputAt: number;
  now: number;
  isAlternateBuffer: boolean;
  isSessionPane: boolean;
};

export type TuiDetectResult = {
  status: SessionDotStatus;
  /** Text match is confirmed; idle silence is only possible. */
  awaitingConfidence?: "confirmed" | "possible";
  textHit: boolean;
};

/** Strip CSI / OSC / common SGR so dialog copy is matchable. */
export function stripAnsi(input: string): string {
  return input
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, "")
    .replace(/\r/g, "");
}

/**
 * High-confidence permission / confirmation UI patterns for Claude Code / Codex TUIs.
 * Multi-signal only — lone "Allow" or system "permission denied" must not match.
 */
export function detectPermissionPromptText(visibleText: string): boolean {
  const text = stripAnsi(visibleText);
  if (!text.trim()) return false;

  // System errno noise — never treat as an agent approval UI.
  if (/\bpermission denied\b/i.test(text) && !/\b(allow once|don't allow|do you want)\b/i.test(text)) {
    return false;
  }

  const hasDoYouWant = /\bdo you want (to )?(proceed|allow|run|continue|make|use|grant)\b/i.test(text)
    || /\bdo you want to\b/i.test(text);
  const hasAllowOnce = /\ballow once\b/i.test(text);
  const hasYesDontAsk = /\byes,?\s+and don't ask\b/i.test(text) || /\byes,?\s+allow\b/i.test(text);
  const hasNoAndTell = /\bno,?\s+and tell\b/i.test(text) || /\bno,?\s+and provide\b/i.test(text);
  const hasDontAllow = /\bdon'?t allow\b/i.test(text) || /\bdo not allow\b/i.test(text);
  const hasAllow = /\ballow\b/i.test(text);
  const hasApprove = /\bapprove\b/i.test(text);
  const hasWaitingApproval = /\bwaiting for approval\b/i.test(text)
    || /\bawaiting (confirmation|approval|permission)\b/i.test(text);
  const hasYnPermission = /\(y\/n\)/i.test(text) && /\b(allow|permission|approve|proceed)\b/i.test(text);
  const hasEscHint = /\besc(ape)? to\b/i.test(text);

  // Claude-style multi-option permission dialog.
  if (hasDoYouWant && (hasAllowOnce || hasYesDontAsk || hasNoAndTell || hasEscHint)) return true;
  if (hasAllowOnce && (hasYesDontAsk || hasNoAndTell || hasDoYouWant)) return true;

  // Codex-style allow / don't allow pair.
  if (hasAllow && hasDontAllow) return true;
  if (hasApprove && (hasDontAllow || hasAllowOnce || hasDoYouWant)) return true;

  if (hasWaitingApproval) return true;
  if (hasYnPermission) return true;

  return false;
}

export function detectTuiSessionStatus(input: TuiDetectInput): TuiDetectResult {
  if (!input.isSessionPane) {
    return { status: "open", textHit: false };
  }

  const textHit = detectPermissionPromptText(input.visibleText);
  if (textHit) {
    return { status: "awaiting_user", awaitingConfidence: "confirmed", textHit: true };
  }

  const silentFor = Math.max(0, input.now - input.lastOutputAt);
  if (silentFor < TUI_RUNNING_MS) {
    return { status: "running", textHit: false };
  }

  // Full-screen TUIs often freeze on permission / plan confirm with no further output.
  if (input.isAlternateBuffer && silentFor >= TUI_IDLE_AWAIT_MS) {
    return { status: "awaiting_user", awaitingConfidence: "possible", textHit: false };
  }

  return { status: "open", textHit: false };
}

export type TuiDebounceState = {
  hitStreak: number;
  missStreak: number;
  confirmedTextAwaiting: boolean;
};

export function createTuiDebounceState(): TuiDebounceState {
  return { hitStreak: 0, missStreak: 0, confirmedTextAwaiting: false };
}

/**
 * Debounce text hits so alternate-buffer redraws don't flash awaiting on/off.
 * Idle (possible) awaiting is applied immediately from detectTuiSessionStatus.
 */
export function applyTuiDebounce(
  state: TuiDebounceState,
  sample: TuiDetectResult
): { status: SessionDotStatus; awaitingConfidence?: "confirmed" | "possible"; state: TuiDebounceState } {
  const next: TuiDebounceState = { ...state };

  if (sample.textHit) {
    next.hitStreak += 1;
    next.missStreak = 0;
    if (next.hitStreak >= TUI_TEXT_HIT_STREAK) next.confirmedTextAwaiting = true;
  } else {
    next.missStreak += 1;
    next.hitStreak = 0;
    if (next.missStreak >= TUI_TEXT_MISS_STREAK) next.confirmedTextAwaiting = false;
  }

  if (next.confirmedTextAwaiting) {
    return { status: "awaiting_user", awaitingConfidence: "confirmed", state: next };
  }

  // Unconfirmed text hit: do not flash awaiting (alternate-buffer redraw noise).
  if (sample.textHit) {
    return { status: "running", state: next };
  }

  // No text dialog: keep sample status (running / possible idle / open).
  return {
    status: sample.status,
    awaitingConfidence: sample.status === "awaiting_user" ? sample.awaitingConfidence : undefined,
    state: next
  };
}
