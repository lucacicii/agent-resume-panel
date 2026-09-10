/**
 * Tier 1.5 — prompt construction for the status adjudicator.
 *
 * The judge answers exactly one question: is this agent blocked waiting for
 * the user right now? Kept in its own file so the wording can be reviewed and
 * tested without touching transport or store code.
 *
 * Design rule: the false-positive list matters more than the positive list.
 * A wrong "waiting for you" is worse than a missed cue, so the prompt is
 * written to reject scrollback, source code and plain prompts explicitly.
 */

export type JudgeRequest = {
  /** Stable identity of the pane this screen belongs to (echoed back). */
  paneKey: string;
  /** Visible screen text, already ANSI-stripped and capped by the caller. */
  screenText: string;
  /** Milliseconds since the last PTY output. */
  silentMs: number;
  /** Tier 1 evidence: a command is executing beneath the agent. */
  toolRunning: boolean;
};

export type JudgeVerdict = {
  paneKey: string;
  awaiting: boolean;
  reason?: string;
};

/** Cap per screen so a batch of panes cannot blow up the context. */
export const MAX_SCREEN_CHARS = 4_000;

const INSTRUCTIONS = `You watch terminal output from AI coding agents and decide ONE thing:
is the agent currently BLOCKED waiting for the user to press a key, make a choice, or approve something?

Answer waiting=true ONLY when the screen shows an interactive prompt that requires user input to continue. Typical evidence:
- A highlighted / arrow-marked choice list (e.g. "-> Option A", "❯ 1. Yes", "> Allow") where a selection must be made
- A yes/no or [y/N] confirmation question that blocks execution
- An explicit question addressed to the user that stops progress
- A permission / approval dialog listing options

Answer waiting=false when any of these is true:
- A shell prompt or the agent is simply ready for the next task (it already finished the turn)
- Output is still being produced
- Condition: toolRunning is true (a command is executing, so nothing is blocked)
- The allow/yes/no wording is inside a log, source code, diff, or scrollback, not an active prompt
- The screen merely lists files, results, plans, or an explanation without a blocking question
- It is ambiguous

When unsure, answer false. Silently mislabelling idle as "waiting for you" is the worst outcome.
Return ONLY compact JSON: {"awaiting": true|false, "reason": "<=12 words"}`;

/** Trim, drop blank noise and cap the screen text. */
export function prepareScreenText(raw: string, maxChars = MAX_SCREEN_CHARS): string {
  const trimmed = raw
    .split("\n")
    .map((line) => line.replace(/\s+$/g, ""))
    .filter((line) => line.trim().length > 0)
    .join("\n")
    .trim();
  if (trimmed.length <= maxChars) return trimmed;
  // Keep the bottom of the screen: prompts live near the cursor.
  return trimmed.slice(-maxChars);
}

/** Build one prompt covering every pending request (batching keeps cost linear). */
export function buildJudgePrompt(requests: readonly JudgeRequest[]): string {
  const blocks = requests.map((request, index) => {
    const parts = [
      `--- SCREEN ${index + 1} (id: ${request.paneKey}) ---`,
      `silentForMs: ${Math.round(request.silentMs)}`,
      `toolRunning: ${request.toolRunning}`
    ];
    const body = prepareScreenText(request.screenText);
    parts.push(body.length ? body : "(screen is empty)");
    return parts.join("\n");
  });

  return `${INSTRUCTIONS}

You will receive ${requests.length} screen(s). Return ONLY compact JSON in this exact shape:
{"verdicts":[{"id":"<screen id>","awaiting":true|false,"reason":"<=12 words"}]}

${blocks.join("\n\n")}`;
}

/**
 * Parse the judge reply. Defensive on purpose: models wrap JSON in prose or
 * markdown fences, and a parse failure must degrade to "not waiting" rather
 * than surfacing an error into the status pipeline.
 */
export function parseJudgeVerdicts(
  raw: string,
  requests: readonly JudgeRequest[]
): JudgeVerdict[] {
  const fallback = requests.map((request) => ({ paneKey: request.paneKey, awaiting: false }));

  const text = extractJson(raw);
  if (!text) return fallback;

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return fallback;
  }

  const list = Array.isArray(parsed)
    ? parsed
    : (parsed as { verdicts?: unknown })?.verdicts;
  if (!Array.isArray(list)) return fallback;

  const byId = new Map<string, JudgeVerdict>();
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const id = typeof record.id === "string" ? record.id : "";
    if (!id) continue;
    if (typeof record.awaiting !== "boolean") continue;
    byId.set(id, {
      paneKey: id,
      awaiting: record.awaiting,
      reason: typeof record.reason === "string" ? record.reason.trim().slice(0, 120) : undefined
    });
  }

  // Echo every request; anything the model omitted is treated as not-waiting.
  return requests.map((request) => byId.get(request.paneKey) ?? { paneKey: request.paneKey, awaiting: false });
}

/** Pull the first JSON object/array out of a reply that may contain prose. */
function extractJson(raw: string): string | null {
  if (typeof raw !== "string") return null;
  const text = raw.trim();
  if (!text) return null;

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = (fenced ? fenced[1]! : text).trim();

  const start = candidate.search(/[[{]/);
  if (start < 0) return null;
  const opener = candidate[start];
  const closer = opener === "{" ? "}" : "]";
  const end = candidate.lastIndexOf(closer);
  if (end <= start) return null;
  return candidate.slice(start, end + 1);
}
