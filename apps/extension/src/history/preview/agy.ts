import * as path from "node:path";
import { AgentSession } from "../types";
import { readJsonLines } from "../jsonl";
import { PreviewHomes, PreviewMessage, SessionPreviewResult } from "./types";
import { candidateAgyRoots } from "./agyRoots";
import { finalizePreviewMessages } from "./text";

interface AntigravityTranscriptRow {
  type?: string;
  step_index?: number;
  content?: string | null;
  thinking?: string | null;
  created_at?: string;
}

interface AntigravityHistoryRow {
  display?: string;
  conversationId?: string;
}

/**
 * Every `USER_INPUT` row wraps the prompt in `<USER_REQUEST>` and appends the
 * environment noise (`ADDITIONAL_METADATA`, `USER_SETTINGS_CHANGE`, and the
 * slash-command `<PLAN>` prose) after it — only the request itself is the turn.
 */
const USER_REQUEST = /<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/i;
const METADATA_BLOCK = /<(?:ADDITIONAL_METADATA|USER_SETTINGS_CHANGE|CONVERSATION_HISTORY|SYSTEM_MESSAGE|PLAN)>[\s\S]*?<\/(?:ADDITIONAL_METADATA|USER_SETTINGS_CHANGE|CONVERSATION_HISTORY|SYSTEM_MESSAGE|PLAN)>/gi;

/**
 * Antigravity (agy) keeps each conversation as plaintext under
 * `brain/<conversation id>/.system_generated/logs`; the `history.jsonl` index
 * only carries the last prompt, which is why the preview used to show a single
 * turn.
 */
export async function previewAgySession(session: AgentSession, homes: PreviewHomes): Promise<SessionPreviewResult> {
  if (!session.id || path.basename(session.id) !== session.id) {
    throw new Error("Antigravity transcript not available for this session.");
  }

  const roots = candidateAgyRoots(homes.antigravityHome);
  let sawTranscript = false;
  for (const root of roots) {
    const transcript = await readBrainTranscript(path.join(root, "brain", session.id, ".system_generated", "logs"));
    sawTranscript = sawTranscript || transcript.logged;
    if (transcript.messages.length) {
      return finalizePreviewMessages(session.title, transcript.messages);
    }
  }
  // The transcript survived but holds no turn yet: an empty session, not a
  // missing one.
  if (sawTranscript) {
    return finalizePreviewMessages(session.title, []);
  }

  // No transcript at all (a conversation interrupted before its first log
  // flush): the index still knows the last prompt, so show that much.
  for (const root of roots) {
    const rows = await readJsonLines<AntigravityHistoryRow>(path.join(root, "history.jsonl"));
    const match = rows.filter((row) => row.conversationId === session.id).at(-1);
    if (match?.display?.trim()) {
      return finalizePreviewMessages(
        session.title,
        [{ role: "user", text: match.display.trim() }],
        "Antigravity only exposes limited history metadata for this session; full transcript preview is unavailable."
      );
    }
  }

  throw new Error("Antigravity transcript not available for this session.");
}

/**
 * Both logs are needed, because neither alone is complete: the summary file
 * truncates long fields (2048 chars, a `<truncated N bytes>` marker, 2048 more)
 * including the planner's own text, while the full file can be missing the head
 * of a conversation it was rotated into. Merging on `step_index` also collapses
 * the prefix copies some conversations contain.
 */
async function readBrainTranscript(logsDir: string): Promise<{ logged: boolean; messages: PreviewMessage[] }> {
  const byStep = new Map<number, AntigravityTranscriptRow>();
  let logged = false;
  for (const fileName of ["transcript.jsonl", "transcript_full.jsonl"]) {
    const rows = await readJsonLines<AntigravityTranscriptRow>(path.join(logsDir, fileName));
    if (rows.length) logged = true;
    // The full file is read second so its untruncated row wins per step.
    for (const row of rows) {
      if (typeof row.step_index !== "number") {
        continue;
      }
      byStep.set(row.step_index, row);
    }
  }

  const messages: PreviewMessage[] = [];
  for (const step of [...byStep.keys()].sort((a, b) => a - b)) {
    const row = byStep.get(step)!;
    const timestamp = row.created_at || undefined;
    if (row.type === "USER_INPUT") {
      const text = userRequestText(row.content);
      if (text) messages.push({ role: "user", text, timestamp });
      continue;
    }
    if (row.type !== "PLANNER_RESPONSE") {
      continue;
    }
    const text = (row.content ?? "").trim();
    const thinking = (row.thinking ?? "").trim();
    if (!text && !thinking) {
      continue;
    }
    messages.push({ role: "assistant", text, thinking: thinking || undefined, timestamp });
  }

  return { logged, messages };
}

function userRequestText(content: string | null | undefined): string {
  const raw = content ?? "";
  const request = USER_REQUEST.exec(raw);
  if (request) {
    return request[1].trim();
  }
  return raw.replace(METADATA_BLOCK, "").trim();
}
