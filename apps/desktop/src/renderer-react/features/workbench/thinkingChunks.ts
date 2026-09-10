/**
 * Splits model reasoning into short display chunks for the rolling
 * "thinking" reel (the iOS-clock style vertical ticker in the transcript pane).
 *
 * Chunk boundaries are append-stable: appending text never re-cuts an earlier
 * boundary, so the reel only ever gains lines and lines already on screen keep
 * their identity (and their animation slot).
 */
export const THINKING_CHUNK_MAX_CHARS = 64;
/** Chunks shorter than this are merged into the previous line. */
const CHUNK_MIN_CHARS = 8;
/** A cut never happens before this offset, which keeps short words intact. */
const CUT_FLOOR = 24;

/** Sentence / clause enders that always close a line. */
const HARD_BOUNDARY = "。！？；：…";
/** Commas close a line only once the line is already substantial. */
const SOFT_BOUNDARY = "，、,";
/** ASCII sentence enders close a line when whitespace (or the end) follows. */
const ASCII_BOUNDARY = ".!?;:";

function isBoundary(char: string, next: string, length: number): boolean {
  if (HARD_BOUNDARY.includes(char)) return true;
  if (SOFT_BOUNDARY.includes(char)) return length >= CUT_FLOOR;
  if (ASCII_BOUNDARY.includes(char)) return next === "" || /\s/.test(next);
  return false;
}

function softCutIndex(value: string): number {
  for (let index = value.length - 1; index >= CUT_FLOOR; index -= 1) {
    const char = value[index];
    if (/\s/.test(char) || SOFT_BOUNDARY.includes(char) || HARD_BOUNDARY.includes(char)) {
      return index + 1;
    }
  }
  return value.length;
}

export function splitThinkingChunks(text: string, maxChars = THINKING_CHUNK_MAX_CHARS): string[] {
  const chunks: string[] = [];
  let current = "";

  const push = (value: string): void => {
    const compact = value.replace(/\s+/g, " ").trim();
    if (compact) chunks.push(compact);
  };

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === "\n" || char === "\r") {
      push(current);
      current = "";
      continue;
    }
    // Leading whitespace of a fresh line never starts a chunk.
    if (!current && /\s/.test(char)) continue;
    current += char;

    const next = text[index + 1] ?? "";
    if (current.trim().length >= CHUNK_MIN_CHARS && isBoundary(char, next, current.trim().length)) {
      push(current);
      current = "";
      continue;
    }
    if (current.length >= maxChars) {
      const cut = softCutIndex(current);
      push(current.slice(0, cut));
      current = current.slice(cut);
    }
  }
  push(current);

  return chunks;
}
