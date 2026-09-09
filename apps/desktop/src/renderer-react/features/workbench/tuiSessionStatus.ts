import type { SessionDotStatus } from "./activeSessionDots";

/** Recent PTY output ⇒ treat as running (5s window accommodates model thinking / TTFT). */
export const TUI_RUNNING_MS = 5_000;
/** Minimum quiet window before testing screen dialog/fingerprint (avoids sampling mid-stream). */
export const TUI_QUIET_FOR_FINGERPRINT_MS = 250;
/** Fast attack: single positive sample activates awaiting alert. */
export const TUI_TEXT_HIT_STREAK = 1;
/** Slow decay: consecutive negative samples required to clear text-based awaiting. */
export const TUI_TEXT_MISS_STREAK = 2;

export type SessionStatusSource = "protocol" | "fingerprint" | "activity" | "idle";

export type OscParsedStatus = {
  status: SessionDotStatus;
  awaitingConfidence?: "confirmed" | "possible";
  detail?: string;
};

export type TuiDetectInput = {
  visibleText: string;
  lastOutputAt: number;
  now: number;
  isSessionPane: boolean;
  isAlternateBuffer?: boolean;
  cursorHidden?: boolean;
  protocolOverride?: OscParsedStatus | null;
};

export type TuiDetectResult = {
  status: SessionDotStatus;
  awaitingConfidence?: "confirmed" | "possible";
  textHit: boolean;
  source: SessionStatusSource;
};

/** Strip CSI / OSC / common SGR so dialog copy is matchable. */
export function stripAnsi(input: string): string {
  return input
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, "")
    .replace(/\r/g, "");
}

/**
 * Parse standard & custom Agent Resume OSC sequences:
 * - OSC 633;AR;awaiting[;<kind>] ST -> Agent awaiting user interaction (Pi companion / agent hook)
 * - OSC 633;AR;running ST -> Agent actively executing
 * - OSC 633;AR;idle ST -> Agent completed and idle
 * - OSC 633;A ST -> VS Code Shell Integration: Prompt started (idle)
 * - OSC 633;C ST -> VS Code Shell Integration: Command started (running)
 * - OSC 633;D[;<code>] ST -> VS Code Shell Integration: Command finished (open / error)
 */
export function parseOscAgentStatus(chunk: string): OscParsedStatus | null {
  if (!chunk || !chunk.includes("\x1b]633;")) return null;

  // Custom Agent Resume sequence: \x1b]633;AR;<status>[;<detail>]\x07 or \x1b\\
  const arMatch = chunk.match(/\x1b\]633;AR;(awaiting|running|idle)(?:;([^\x07\x1b]*))?(?:\x07|\x1b\\)/);
  if (arMatch) {
    const kind = arMatch[1];
    const detail = arMatch[2]?.trim() || undefined;
    if (kind === "awaiting") {
      return { status: "awaiting_user", awaitingConfidence: "confirmed", detail };
    }
    if (kind === "running") {
      return { status: "running", detail };
    }
    return { status: "open", detail };
  }

  // Shell integration OSC 633;C ST (Command executing)
  if (/\x1b\]633;C(?:\x07|\x1b\\)/.test(chunk)) {
    return { status: "running" };
  }

  // Shell integration OSC 633;D[;<code>] ST (Command finished)
  const exitMatch = chunk.match(/\x1b\]633;D(?:;(\d+))?(?:\x07|\x1b\\)/);
  if (exitMatch) {
    const code = exitMatch[1] ? Number.parseInt(exitMatch[1], 10) : 0;
    return code === 0 ? { status: "open" } : { status: "error" };
  }

  // Shell integration OSC 633;A ST (Prompt ready / waiting for input)
  if (/\x1b\]633;A(?:\x07|\x1b\\)/.test(chunk)) {
    return { status: "open" };
  }

  return null;
}

/**
 * Strip OSC 633;AR escape sequences from terminal input chunk so they don't leak into xterm display.
 */
export function stripOscAgentStatus(chunk: string): string {
  if (!chunk || !chunk.includes("\x1b]633;AR;")) return chunk;
  return chunk.replace(/\x1b\]633;AR;(?:awaiting|running|idle)(?:;[^\x07\x1b]*)?(?:\x07|\x1b\\)/g, "");
}

/**
 * Interactive selector / menu fingerprint:
 * Detects up/down arrow choice menus (Pi's plan plugin, Ink, Inquirer, Prompts, Curses)
 * without needing language-specific prompt text.
 */
export function detectInteractiveSelector(visibleText: string, cursorHidden?: boolean): boolean {
  const text = stripAnsi(visibleText);
  if (!text.trim()) return false;

  // Disregard bash redirect noise (e.g. echo "foo" > file)
  if (/\b(?:cat|echo|tee)\s*<<?\s*\S+/i.test(text)) return false;

  // Direct hit for Pi plan mode prompt
  if (/\bplan mode\b/i.test(text) && /\b(?:what next|navigate|execute|refine)\b/i.test(text)) {
    return true;
  }

  // Active selector pointer or radio indicators on lines:
  // e.g. "→ Execute the plan", "❯ Option 1", "› Run plan", "● Task A", "[x] Choice B", "(*) Option C"
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  let hasPointer = false;
  let hasChoices = 0;

  for (const line of lines) {
    if (/^[❯›▶▸●◉→\u2192]\s+\S+/.test(line) || /^(?:->|=>)\s+\S+/.test(line) || /^\(\*\)\s+\S+/.test(line)) {
      hasPointer = true;
      hasChoices += 1;
    } else if (/^[○◯]\s+\S+/.test(line) || /^\(\s*\)\s+\S+/.test(line) || /^\[[ xX*]\]\s+\S+/.test(line)) {
      hasChoices += 1;
    }
  }

  // Navigation hint patterns (e.g. "↑↓ navigate enter select", "↑/↓", "use arrow keys", "Plan mode — what next?")
  const hasNavHint = /(?:use arrow keys|[↑▲]\s*[↓▼]|↑\/?↓|上下键(?:选择|移动)?|按回车(?:确认|选择)?|\bnavigate\b|\benter select\b|press (?:enter|return) to (?:select|confirm)|select (?:a|an|one)|choose (?:a|an|one)|\bwhat next\b|\bplan mode\b)/i.test(text);

  // If selector glyph + navigation instruction or multiple radio items:
  if (hasPointer && (hasNavHint || hasChoices >= 2 || cursorHidden === true)) {
    return true;
  }

  if (hasNavHint && hasPointer) {
    return true;
  }

  if (cursorHidden === true && hasNavHint && hasChoices >= 1) {
    return true;
  }

  return false;
}

/**
 * High-confidence permission / confirmation UI patterns for Claude Code / Codex / Pi TUIs.
 * Supports Claude Code tool approvals, [y/N] formats, and Chinese confirmations.
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
  const hasAllowOnce = /\ballow once\b/i.test(text)
    || /\byes,?\s*allow\b/i.test(text)
    || /\byes,?\s*run this (command|tool)\b/i.test(text);
  const hasYesDontAsk = /\byes,?\s+and don't ask\b/i.test(text) || /\byes,?\s+don't ask\b/i.test(text);
  const hasNoAndTell = /\bno,?\s+and tell\b/i.test(text) || /\bno,?\s+and provide\b/i.test(text) || /\bno,?\s+tell\b/i.test(text);
  const hasDontAllow = /\bdon'?t allow\b/i.test(text) || /\bdo not allow\b/i.test(text);
  const hasAllow = /\ballow\b/i.test(text);
  const hasApprove = /\bapprove\b/i.test(text);
  const hasWaitingApproval = /\bwaiting for approval\b/i.test(text)
    || /\bawaiting (confirmation|approval|permission)\b/i.test(text);
  const hasYnPermission = /[\[(][yY]\/[nN][\])]/.test(text)
    && /\b(allow|permission|approve|proceed|continue|run|execute)\b/i.test(text);
  const hasEscHint = /\besc(ape)? to\b/i.test(text);
  const hasYesOption = /\b(?:1[\.\)]\s*)?yes\b/i.test(text);
  const hasNoOption = /\b(?:[23][\.\)]\s*)?no\b/i.test(text);

  // Claude-style multi-option permission dialog (e.g. "Allow bash command ... 1. Yes, run this command / 2. Yes, don't ask again / 3. No")
  if (hasAllow && (hasAllowOnce || hasYesDontAsk || hasNoAndTell || (hasYesOption && hasNoOption))) {
    return true;
  }
  if (hasDoYouWant && (hasAllowOnce || hasYesDontAsk || hasNoAndTell || hasEscHint || (hasYesOption && hasNoOption))) {
    return true;
  }

  // Codex-style allow / don't allow pair
  if (hasAllow && hasDontAllow) return true;
  if (hasApprove && (hasDontAllow || hasAllowOnce || hasDoYouWant)) return true;

  if (hasWaitingApproval) return true;
  if (hasYnPermission) return true;

  // Chinese confirmation / approval patterns
  const hasZhYn = /(?:[（(]是\/否[）)]|[（(]y\/n[）)])/i.test(text) && /(?:是否|允许|执行|继续|批准)/.test(text);
  const hasZhConfirm = /(?:是否|需要)(?:允许|批准|继续|执行|确认)/.test(text)
    && /(?:确认|取消|继续|按\s*(?:Enter|回车)|[12][\.\)])/.test(text);
  const hasZhWaiting = /(?:等待(?:用户)?确认|等待授权)/.test(text);

  if (hasZhYn || hasZhConfirm || hasZhWaiting) return true;

  return false;
}

/**
 * Combined high-confidence Tier 2 fingerprint:
 * Matches interactive selector menus (like Pi plan plugin) or permission prompts.
 */
export function detectTuiFingerprint(input: { visibleText: string; cursorHidden?: boolean }): boolean {
  if (detectInteractiveSelector(input.visibleText, input.cursorHidden)) return true;
  if (detectPermissionPromptText(input.visibleText)) return true;
  return false;
}

export function detectTuiSessionStatus(input: TuiDetectInput): TuiDetectResult {
  if (!input.isSessionPane) {
    return { status: "open", textHit: false, source: "idle" };
  }

  // Tier 1: Protocol Override (OSC from agent / companion bridge)
  if (input.protocolOverride) {
    const isAwaiting = input.protocolOverride.status === "awaiting_user";
    return {
      status: input.protocolOverride.status,
      awaitingConfidence: input.protocolOverride.awaitingConfidence,
      textHit: isAwaiting,
      source: "protocol"
    };
  }

  const silentFor = Math.max(0, input.now - input.lastOutputAt);

  // If output is actively streaming right now (< 600ms), it is running.
  // Active output stream trumps any residual prompt text left in the buffer.
  if (silentFor < TUI_QUIET_FOR_FINGERPRINT_MS) {
    return { status: "running", textHit: false, source: "activity" };
  }

  // Tier 2: Fingerprint and permission prompt detection (menu select or approval dialog)
  const textHit = detectTuiFingerprint({
    visibleText: input.visibleText,
    cursorHidden: input.cursorHidden
  });
  if (textHit) {
    return { status: "awaiting_user", awaitingConfidence: "confirmed", textHit: true, source: "fingerprint" };
  }

  // Tier 3: Recent output window -> running
  if (silentFor < TUI_RUNNING_MS) {
    return { status: "running", textHit: false, source: "activity" };
  }

  // Tier 3: Silent -> open / idle.
  // Fail-Safe: Never falsely flag silence as awaiting_user!
  return { status: "open", textHit: false, source: "idle" };
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
 * Protocol events apply immediately without streak debounce.
 */
export function applyTuiDebounce(
  state: TuiDebounceState,
  sample: TuiDetectResult
): { status: SessionDotStatus; awaitingConfidence?: "confirmed" | "possible"; state: TuiDebounceState } {
  // Protocol status (OSC) applies immediately with 100% confidence
  if (sample.source === "protocol") {
    const next: TuiDebounceState = {
      hitStreak: sample.status === "awaiting_user" ? TUI_TEXT_HIT_STREAK : 0,
      missStreak: sample.status !== "awaiting_user" ? TUI_TEXT_MISS_STREAK : 0,
      confirmedTextAwaiting: sample.status === "awaiting_user"
    };
    return {
      status: sample.status,
      awaitingConfidence: sample.awaitingConfidence,
      state: next
    };
  }

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

  return {
    status: sample.status,
    awaitingConfidence: sample.status === "awaiting_user" ? sample.awaitingConfidence : undefined,
    state: next
  };
}
