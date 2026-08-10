/**
 * Normalize user selection / seed text into a searchable identifier.
 * Pure helper — no LLM, no workspace I/O.
 */

const MAX_SELECTION_LEN = 80;

export function normalizeLinkGraphSymbol(
  selection: string
): { symbol: string; wholeWord: boolean } | null {
  const trimmed = selection.trim().replace(/\s+/g, " ");
  if (!trimmed || trimmed.length > MAX_SELECTION_LEN) return null;

  const member = trimmed.match(/^(?:[\w$]+\.)+([\w$]+)$/);
  if (member?.[1]) {
    return { symbol: member[1], wholeWord: true };
  }

  if (/^[A-Za-z_$][\w$]*$/.test(trimmed)) {
    return { symbol: trimmed, wholeWord: true };
  }

  if (trimmed.length >= 2 && !trimmed.includes("\n")) {
    return { symbol: trimmed, wholeWord: false };
  }

  return null;
}
