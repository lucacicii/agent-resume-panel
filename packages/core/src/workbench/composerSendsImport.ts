import type { AgentSession } from "../catalog/types";
import { loadSessionPreview } from "../transcript/load";
import type { PreviewHomes } from "../transcript/types";
import { appendComposerSend, listComposerSends } from "./composerSends";

/**
 * Noise patterns for auto-imported user messages. Composer tips only surface
 * messages the human actually typed; system injections / shell chatter and
 * agent-internal command rows should never reach the send log.
 */
const NOISE_PATTERNS: RegExp[] = [
  // System/tool wrappers
  /^<(?:tool_result|tool_use|tool-use|command-name|command-message|command-args|local-command-stdout|local-command-stderr|total_tokens|task-notification|suggestion|function_call|function-call)\b/i,
  /^\[Request interrupted\b/i,
  /^\[Use arrows to review\b/i,
  // Agent-resume internal slash commands (not user goals)
  /^\/(?:new|compact|clear|init|help|model|tokens|undo|redo|review|resume|share|quit|exit)\b/i
];

const MIN_TIP_TEXT_LENGTH = 2;

function isNoise(text: string): boolean {
  return NOISE_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * Decide whether a parsed user message belongs in the composer send log.
 * Shared with the composer tip UI: text must carry real instructions, not
 * system noise or one-liner shell syntax without a goal.
 */
export function shouldImportComposerSendText(text: string): boolean {
  const trimmed = text?.trim();
  if (!trimmed || trimmed.length < MIN_TIP_TEXT_LENGTH) {
    return false;
  }
  if (isNoise(trimmed)) {
    return false;
  }
  return true;
}

export interface ImportComposerSendsResult {
  /** New rows appended to workbench_composer_sends. */
  imported: number;
  /** User messages skipped because they already exist or failed filters. */
  skipped: number;
  /** Total user messages found in the session transcript. */
  found: number;
}

/**
 * Import the historical user inputs of one agent session into
 * workbench_composer_sends so the session composer shows them as tips.
 *
 * Append-only by contract: existing identical texts under the same
 * agent_session_id are never duplicated. The function is best-effort — a
 * session without a readable transcript silently returns zero imports.
 */
export async function importComposerSendsForSession(
  dbPath: string,
  session: AgentSession,
  homes: PreviewHomes
): Promise<ImportComposerSendsResult> {
  let preview;
  try {
    preview = await loadSessionPreview(session, homes);
  } catch {
    return { imported: 0, skipped: 0, found: 0 };
  }

  if (!preview.messages.length) {
    return { imported: 0, skipped: 0, found: 0 };
  }

  const existing = await listComposerSends(dbPath, {
    agentSessionId: session.id,
    limit: 500
  });
  const seen = new Set(existing.map((record) => record.text));

  let found = 0;
  let imported = 0;
  let skipped = 0;
  const projectPath = session.projectPath?.trim() || "";
  const paneKey = `import:${session.provider}:${session.id}`;

  for (const message of preview.messages) {
    if (message.role !== "user") {
      continue;
    }
    const text = message.text?.trim();
    if (!text) {
      continue;
    }
    found += 1;
    if (!shouldImportComposerSendText(text)) {
      skipped += 1;
      continue;
    }
    if (seen.has(text)) {
      skipped += 1;
      continue;
    }
    try {
      await appendComposerSend(dbPath, {
        paneKey,
        projectPath,
        provider: session.provider,
        agentSessionId: session.id,
        text
      });
      seen.add(text);
      imported += 1;
    } catch {
      skipped += 1;
    }
  }

  return { imported, skipped, found };
}
