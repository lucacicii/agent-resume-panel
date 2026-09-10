/**
 * Tier 2 — screen-content fingerprinting.
 *
 * Last-resort detection for agents that expose no hook and emit no status
 * sequence. Pure string analysis: give it text, get a verdict. It never reads
 * a terminal, never holds state, and never touches React.
 *
 * Keep every pattern here *multi-signal*. A single loose keyword produces
 * false "waiting for you" alarms, which are worse than a missed detection.
 */

import { stripAnsi } from "./protocol";

/** Pointer glyphs across agent TUIs (Pi `→`, Claude `❯`/`›`, Codex `●`). */
const POINTER_GLYPHS = "❯›▶▸●◉→";
/** A glyph pointer is strong evidence — these rarely start a prose line. */
const GLYPH_POINTER_LINE = new RegExp(`^[${POINTER_GLYPHS}\\u2192]\\s+\\S+`);
/** Checked radio / checkbox markers are equally strong. */
const CHECKED_RADIO_LINE = /^\(\*\)\s+\S+/;
/** Unchecked siblings count toward "this is a list of options". */
const UNCHECKED_GLYPH_LINE = /^[○◯]\s+\S+/;
const UNCHECKED_RADIO_LINE = /^\(\s*\)\s+\S+/;
const UNCHECKED_CHECKBOX_LINE = /^\[[ xX*]\]\s+\S+/;
/**
 * ASCII arrows appear in prose, quotes and shell redirects, so they only count
 * once something else already suggests an interactive menu.
 */
const ASCII_POINTER_LINE = /^(?:->|=>)\s+\S+/;

/** "use arrow keys", "↑↓ navigate", "上下键选择", "press enter to select", … */
const NAVIGATION_HINT = new RegExp(
  [
    "use arrow keys",
    "[↑▲]\\s*[↓▼]",
    "↑\\/?↓",
    "上下键(?:选择|移动)?",
    "按回车(?:确认|选择)?",
    "\\bnavigate\\b",
    "\\benter select\\b",
    "press (?:enter|return) to (?:select|confirm)",
    "select (?:a|an|one)",
    "choose (?:a|an|one)",
    "\\bwhat next\\b",
    "\\bplan mode\\b"
  ].join("|"),
  "i"
);

/** Pi's plan plugin prints exactly this shape; treat it as a direct hit. */
const PLAN_MODE_PROMPT = /\bplan mode\b/i;
const PLAN_MODE_ACTION = /\b(?:what next|navigate|execute|refine)\b/i;

/** Shell heredoc noise that must never be mistaken for a menu. */
const HEREDOC_NOISE = /\b(?:cat|echo|tee)\s*<<?\s*\S+/i;

/**
 * Interactive selector / choice-menu fingerprint.
 *
 * Detects up/down arrow menus (Pi plan plugin, Ink, Inquirer, Prompts, curses)
 * without depending on any language-specific prompt copy.
 */
export function detectInteractiveSelector(visibleText: string, cursorHidden?: boolean): boolean {
  const text = stripAnsi(visibleText);
  if (!text.trim()) return false;
  if (HEREDOC_NOISE.test(text)) return false;

  if (PLAN_MODE_PROMPT.test(text) && PLAN_MODE_ACTION.test(text)) return true;

  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  let marked = 0;
  let asciiPointers = 0;

  for (const line of lines) {
    if (GLYPH_POINTER_LINE.test(line) || CHECKED_RADIO_LINE.test(line)) {
      marked += 1;
    } else if (
      UNCHECKED_GLYPH_LINE.test(line)
      || UNCHECKED_RADIO_LINE.test(line)
      || UNCHECKED_CHECKBOX_LINE.test(line)
    ) {
      marked += 1;
    } else if (ASCII_POINTER_LINE.test(line)) {
      asciiPointers += 1;
    }
  }

  const hasNavHint = NAVIGATION_HINT.test(text);
  const corroborated = hasNavHint || cursorHidden === true;

  // ASCII arrows only become evidence alongside a hint or a hidden cursor.
  const evidence = marked + (corroborated ? asciiPointers : 0);

  if (evidence >= 2) return true;
  if (evidence >= 1 && corroborated) return true;
  return false;
}

/**
 * High-confidence permission / confirmation dialogs for Claude Code, Codex and
 * localized variants. Multi-signal only — a lone "Allow" or a system
 * "permission denied" must not match.
 */
export function detectPermissionPromptText(visibleText: string): boolean {
  const text = stripAnsi(visibleText);
  if (!text.trim()) return false;

  // System errno noise — never an agent approval UI.
  if (/\bpermission denied\b/i.test(text) && !/\b(allow once|don't allow|do you want)\b/i.test(text)) {
    return false;
  }

  const hasDoYouWant = /\bdo you want (to )?(proceed|allow|run|continue|make|use|grant)\b/i.test(text)
    || /\bdo you want to\b/i.test(text);
  const hasAllowOnce = /\ballow once\b/i.test(text)
    || /\byes,?\s*allow\b/i.test(text)
    || /\byes,?\s*run this (command|tool)\b/i.test(text);
  const hasYesDontAsk = /\byes,?\s+and don't ask\b/i.test(text) || /\byes,?\s+don't ask\b/i.test(text);
  const hasNoAndTell = /\bno,?\s+and tell\b/i.test(text)
    || /\bno,?\s+and provide\b/i.test(text)
    || /\bno,?\s+tell\b/i.test(text);
  const hasDontAllow = /\bdon'?t allow\b/i.test(text) || /\bdo not allow\b/i.test(text);
  const hasAllow = /\ballow\b/i.test(text);
  const hasApprove = /\bapprove\b/i.test(text);
  const hasWaitingApproval = /\bwaiting for approval\b/i.test(text)
    || /\bawaiting (confirmation|approval|permission)\b/i.test(text);
  const hasYnPermission = /[[(][yY]\/[nN][\])]/.test(text)
    && /\b(allow|permission|approve|proceed|continue|run|execute)\b/i.test(text);
  const hasEscHint = /\besc(ape)? to\b/i.test(text);
  const hasYesOption = /\b(?:1[.)]\s*)?yes\b/i.test(text);
  const hasNoOption = /\b(?:[23][.)]\s*)?no\b/i.test(text);

  // Claude-style multi-option dialog.
  if (hasAllow && (hasAllowOnce || hasYesDontAsk || hasNoAndTell || (hasYesOption && hasNoOption))) {
    return true;
  }
  if (hasDoYouWant && (hasAllowOnce || hasYesDontAsk || hasNoAndTell || hasEscHint || (hasYesOption && hasNoOption))) {
    return true;
  }

  // Codex-style allow / don't allow pair.
  if (hasAllow && hasDontAllow) return true;
  if (hasApprove && (hasDontAllow || hasAllowOnce || hasDoYouWant)) return true;

  if (hasWaitingApproval) return true;
  if (hasYnPermission) return true;

  // Chinese confirmation / approval patterns.
  const hasZhYn = /(?:[（(]是\/否[）)]|[（(]y\/n[）)])/i.test(text) && /(?:是否|允许|执行|继续|批准)/.test(text);
  const hasZhConfirm = /(?:是否|需要)(?:允许|批准|继续|执行|确认)/.test(text)
    && /(?:确认|取消|继续|按\s*(?:Enter|回车)|[12][.)])/.test(text);
  const hasZhWaiting = /(?:等待(?:用户)?确认|等待授权)/.test(text);

  return hasZhYn || hasZhConfirm || hasZhWaiting;
}

/** True when the visible screen shows any interactive affordance we trust. */
export function detectScreenFingerprint(input: {
  visibleText: string;
  cursorHidden?: boolean;
}): boolean {
  if (detectInteractiveSelector(input.visibleText, input.cursorHidden)) return true;
  return detectPermissionPromptText(input.visibleText);
}
