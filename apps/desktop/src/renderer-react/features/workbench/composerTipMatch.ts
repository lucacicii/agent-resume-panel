export type TranscriptUserHit = {
  id: string;
  text: string;
  timestamp?: string;
};

const MEDIA_MARKDOWN = /!\[[^\]]*]\([^)]*\)/g;
const MEDIA_PATH = /(?:^|\s)(?:\/|[A-Za-z]:[\\/]|\.\/|\.\.\/)?[\w./\\-]+\.(?:png|jpe?g|webp|gif|pdf|svg)(?:\s|$)/gi;
const MEDIA_PLACEHOLDER = /\[(?:image|img|file)\]|📷/gi;

export function normalizeTipText(value: string): string {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(MEDIA_MARKDOWN, " ")
    .replace(MEDIA_PATH, " ")
    .replace(MEDIA_PLACEHOLDER, " ")
    .replace(/[\u3000\s]+/g, " ")
    .trim();
}

function parseTimestampMs(value?: string): number | null {
  if (!value) return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && String(numeric) === value) return numeric < 1e12 ? numeric * 1000 : numeric;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function firstLine(value: string): string {
  return value.split("\n")[0]?.trim() || value;
}

function scoreMatch(tip: string, transcript: string): number {
  if (!tip || !transcript) return 0;
  if (tip === transcript) return 100;
  if (transcript.endsWith(tip)) return 90;
  const shorter = tip.length <= transcript.length ? tip : transcript;
  const longer = tip.length <= transcript.length ? transcript : tip;
  if (longer.includes(shorter) && (shorter.length >= 16 || shorter.length / longer.length >= 0.4)) {
    return tip.length <= transcript.length ? 80 : 50;
  }
  if (firstLine(tip) && firstLine(tip) === firstLine(transcript)) return 70;
  return 0;
}

/**
 * Pick the user transcript bubble that best matches a composer tip.
 * Prefer exact / suffix matches (TUI prefix + composer text). Ties take the
 * later message. Returns null instead of a weak guess.
 */
export function findTranscriptUserMessage(
  messages: readonly TranscriptUserHit[],
  tipText: string,
  sentAtMs?: number
): TranscriptUserHit | null {
  const tip = normalizeTipText(tipText);
  if (!tip) return null;
  let best: { message: TranscriptUserHit; score: number; index: number } | null = null;
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    const score = scoreMatch(tip, normalizeTipText(message.text));
    if (score <= 0) continue;
    let nextScore = score;
    if (sentAtMs != null) {
      const stamp = parseTimestampMs(message.timestamp);
      if (stamp != null && Math.abs(stamp - sentAtMs) <= 120_000) nextScore += 1;
    }
    if (!best || nextScore > best.score || (nextScore === best.score && index > best.index)) {
      best = { message, score: nextScore, index };
    }
  }
  return best && best.score >= 70 ? best.message : null;
}
