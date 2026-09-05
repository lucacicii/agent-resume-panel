import { COMPOSER_SEND_TEXT_MAX } from "./composerSends";

const MIN_TIP_TEXT_LENGTH = 2;

/** Same-session user rows closer than this (with no human-speed outlier) are one TUI/stdout burst. */
export const COMPOSER_IMPORT_BURST_GAP_MS = 5 * 60 * 1000;
const MIN_BURST_LENGTH = 3;

const WRAPPER_NOISE =
  /^(?:<(?:tool_result|tool_use|tool-use|command-name|command-message|command-args|local-command-stdout|local-command-stderr|local-command-caveat|total_tokens|task-notification|suggestion|function_call|function-call)\b|\[Request interrupted\b|\[Use arrows to review\b)/i;

const INTERNAL_SLASH =
  /^\/(?:new|compact|clear|init|help|model|tokens|undo|redo|review|resume|share|quit|exit)\b/i;

const SHELL_PROMPT_ECHO = /^\$\s+\S/;
const DEV_SCRIPT_TAG = /^\[dev\]\s/i;
const COPIED_ASSET = /^copied \S.+\s(?:→|->)\s\S/i;
const ESBUILD_CROSS = /^✘\s/;
const TS_ERROR = /^error TS\d+/i;
const NODE_INTERNAL = /^node:internal\//;
const BOX_DRAWING = /^[╵│]\s/;
const SQUIGGLE_ONLY = /^~{3,}/;
const TILDE_ART_LINE = /~{5,}/;
const BOX_DRAWING_ART_LINE = /[│╵]/;
const EMSCRIPT_PATH_PREFIX = /^\.\.\/\.\.\/packages\//;
const PATH_LINE_COL = /^\S+\.[A-Za-z][\w.-]*:\d+:\d+:/;
const NUMBERED_BOX_LINE = /^\d+\s+│/;
const CJK = /[\u4e00-\u9fff]/;
const LOG_RESIDUAL_LOCAL =
  /^(?:The package |Are you trying |will remove this |You can use |wasn't found |The file |The command |npm (?:error|warn)|ELIFECYCLE|▲ \[WARNING\])/i;
const COMPILER_PHRASE =
  /Could not resolve|file system but is built into|platform:\s*'node'|running initial build/i;

export type ComposerImportCandidate = {
  text: string;
  createdAtMs: number;
};

export function isComposerSendNoise(text: string): boolean {
  const trimmed = text?.trim() ?? "";
  if (!trimmed || trimmed.length < MIN_TIP_TEXT_LENGTH) return true;
  if (WRAPPER_NOISE.test(trimmed)) return true;
  if (INTERNAL_SLASH.test(trimmed)) return true;
  if (trimmed.includes("<turn_aborted>")) return true;
  if (trimmed.includes("<local-command-caveat>")) return true;
  if (SHELL_PROMPT_ECHO.test(trimmed)) return true;
  if (DEV_SCRIPT_TAG.test(trimmed)) return true;
  if (COPIED_ASSET.test(trimmed)) return true;
  if (ESBUILD_CROSS.test(trimmed)) return true;
  if (TS_ERROR.test(trimmed)) return true;
  if (NODE_INTERNAL.test(trimmed)) return true;
  if (trimmed.includes("wasn't found on the file system") && trimmed.includes("built into")) return true;
  if (EMSCRIPT_PATH_PREFIX.test(trimmed)) return true;
  if (TILDE_ART_LINE.test(trimmed)) return true;
  if (BOX_DRAWING_ART_LINE.test(trimmed)) return true;
  if (BOX_DRAWING.test(trimmed)) return true;
  if (SQUIGGLE_ONLY.test(trimmed)) return true;
  if (PATH_LINE_COL.test(trimmed)) return true;
  if (NUMBERED_BOX_LINE.test(trimmed)) return true;
  if (trimmed.length >= COMPOSER_SEND_TEXT_MAX) return true;
  if (trimmed.length > 8000 && looksLikeStack(trimmed)) return true;
  if (LOG_RESIDUAL_LOCAL.test(trimmed)) return true;
  if (COMPILER_PHRASE.test(trimmed)) return true;
  return false;
}

function looksLikeStack(text: string): boolean {
  if (text.includes("node:internal")) return true;
  const lines = text.split("\n");
  if (lines.length < 40) return false;
  return /(?:^|\n)\s*at \S+ \(/m.test(text);
}

function isLikelyTerminalEcho(text: string): boolean {
  if (isComposerSendNoise(text)) return true;
  const trimmed = text.trim();
  if (trimmed.includes("\n")) return false;
  if (CJK.test(trimmed)) return false;
  if (trimmed.length > 200) return false;
  if (LOG_RESIDUAL_LOCAL.test(trimmed)) return true;
  if (COMPILER_PHRASE.test(trimmed)) return true;
  return false;
}

/**
 * Keep real user instructions; drop wrappers, shell/build echoes, and
 * sub-2s TUI stdout bursts that were recorded as consecutive user rows.
 */
export function filterComposerImportCandidates(
  messages: ComposerImportCandidate[]
): ComposerImportCandidate[] {
  const ordered = messages
    .map((message) => ({
      text: message.text?.trim() ?? "",
      createdAtMs: message.createdAtMs
    }))
    .filter((message) => message.text.length >= MIN_TIP_TEXT_LENGTH)
    .sort((a, b) => a.createdAtMs - b.createdAtMs || a.text.localeCompare(b.text));

  const kept: ComposerImportCandidate[] = [];
  let index = 0;
  while (index < ordered.length) {
    let end = index + 1;
    while (
      end < ordered.length &&
      ordered[end].createdAtMs - ordered[end - 1].createdAtMs < COMPOSER_IMPORT_BURST_GAP_MS
    ) {
      end += 1;
    }
    const run = ordered.slice(index, end);
    const directNoise = run.filter((row) => isComposerSendNoise(row.text));
    // Skip the whole terminal blob only when nothing in the run looks human.
    // Isolated TUI noise next to real instructions is already dropped above,
    // so mixed runs (build log + a mid-run question) can keep the human part.
    const hasHumanOutlier = run.some(
      (row) => !isLikelyTerminalEcho(row.text) && !isComposerSendNoise(row.text)
    );
    const echoCount = run.filter((row) => isLikelyTerminalEcho(row.text)).length;
    const dropEcho =
      !hasHumanOutlier && directNoise.length > 0 && echoCount >= Math.ceil(run.length * 0.6);
    for (const row of run) {
      if (isComposerSendNoise(row.text)) continue;
      if (dropEcho && isLikelyTerminalEcho(row.text)) continue;
      kept.push(row);
    }
    index = end;
  }
  return kept;
}
