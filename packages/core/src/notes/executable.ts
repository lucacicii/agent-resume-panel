/**
 * Executable Note blocks — GTD-style fenced directives for note-driven orchestration.
 *
 *   :::note-child idle
 *   Implement batch GTD API
 *   :::
 *
 *   :::note-child idle note=0186… status=idle
 *   Implement batch GTD API
 *   :::
 *
 *   :::session codex idle
 *   optional prompt body
 *   :::
 *
 *   :::session codex running native=codex/abc123
 *   …
 *   :::
 *
 *   :::run awaiting_approval
 *   optional description
 *   :::
 *
 *   :::result completed
 *   summary markdown
 *   :::
 */

export const NOTE_CHILD_STATUSES = ["idle", "planned", "running", "done", "failed"] as const;
export type NoteChildStatus = (typeof NOTE_CHILD_STATUSES)[number];

export const SESSION_BLOCK_STATUSES = ["idle", "planned", "running", "settled", "failed"] as const;
export type SessionBlockStatus = (typeof SESSION_BLOCK_STATUSES)[number];

export const RUN_BLOCK_STATUSES = [
  "draft",
  "awaiting_approval",
  "executing",
  "completed",
  "partial",
  "failed"
] as const;
export type RunBlockStatus = (typeof RUN_BLOCK_STATUSES)[number];

export const RESULT_BLOCK_STATUSES = ["completed", "failed", "partial", "blocked"] as const;
export type ResultBlockStatus = (typeof RESULT_BLOCK_STATUSES)[number];

export interface NoteChildBlock {
  kind: "note-child";
  /** Document order (0-based among note-child blocks). */
  index: number;
  /** One-based source line of the opening fence. */
  line: number;
  status: NoteChildStatus;
  /** Linked child note id when materialized. */
  noteId?: string;
  /** Body text (title / task description). */
  text: string;
  blockStart: number;
  blockEnd: number;
}

export interface SessionBlock {
  kind: "session";
  index: number;
  line: number;
  provider: string;
  status: SessionBlockStatus;
  /** Native catalog session as `provider/sessionId`. */
  native?: string;
  /** Optional prompt / instructions body. */
  text: string;
  blockStart: number;
  blockEnd: number;
}

export interface RunBlock {
  kind: "run";
  index: number;
  line: number;
  status: RunBlockStatus;
  text: string;
  blockStart: number;
  blockEnd: number;
}

export interface ResultBlock {
  kind: "result";
  index: number;
  line: number;
  status: ResultBlockStatus;
  text: string;
  blockStart: number;
  blockEnd: number;
}

export type ExecutableBlock = NoteChildBlock | SessionBlock | RunBlock | ResultBlock;

export interface ParsedExecutableNote {
  noteChildren: NoteChildBlock[];
  sessions: SessionBlock[];
  runs: RunBlock[];
  results: ResultBlock[];
}

const FENCE = /^\s{0,3}(`{3,}|~{3,})/;
const NOTE_CHILD_OPEN =
  /^:::note-child\s+([a-z_]+)(?:\s+note=([A-Za-z0-9._-]+))?(?:\s+status=([a-z_]+))?\s*$/;
const SESSION_OPEN =
  /^:::session\s+([A-Za-z0-9._-]+)\s+([a-z_]+)(?:\s+native=([A-Za-z0-9._/:|-]+))?\s*$/;
const RUN_OPEN = /^:::run\s+([a-z_]+)\s*$/;
const RESULT_OPEN = /^:::result\s+([a-z_]+)\s*$/;
const BLOCK_CLOSE = /^:::\s*$/;

function isNoteChildStatus(value: string): value is NoteChildStatus {
  return (NOTE_CHILD_STATUSES as readonly string[]).includes(value);
}

function isSessionBlockStatus(value: string): value is SessionBlockStatus {
  return (SESSION_BLOCK_STATUSES as readonly string[]).includes(value);
}

function isRunBlockStatus(value: string): value is RunBlockStatus {
  return (RUN_BLOCK_STATUSES as readonly string[]).includes(value);
}

function isResultBlockStatus(value: string): value is ResultBlockStatus {
  return (RESULT_BLOCK_STATUSES as readonly string[]).includes(value);
}

function lineOffsets(lines: readonly string[]): number[] {
  const offsets: number[] = [];
  let offset = 0;
  for (const line of lines) {
    offsets.push(offset);
    offset += line.length + 1;
  }
  return offsets;
}

function normalizedText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

interface RawBlock {
  kind: ExecutableBlock["kind"];
  openLine: number;
  closeLine: number;
  blockStart: number;
  blockEnd: number;
  openArgs: string[];
  body: string;
}

function collectDirectiveBlocks(markdown: string): RawBlock[] {
  const lines = markdown.split("\n");
  const offsets = lineOffsets(lines);
  const blocks: RawBlock[] = [];
  let fenceMarker: "`" | "~" | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const fence = line.match(FENCE);
    if (fence) {
      const marker = fence[1][0] as "`" | "~";
      if (fenceMarker === null) fenceMarker = marker;
      else if (fenceMarker === marker) fenceMarker = null;
      continue;
    }
    if (fenceMarker !== null) continue;

    let kind: ExecutableBlock["kind"] | null = null;
    let openArgs: string[] = [];
    const noteChild = line.match(NOTE_CHILD_OPEN);
    if (noteChild) {
      kind = "note-child";
      openArgs = [noteChild[1], noteChild[2] || "", noteChild[3] || ""];
    } else {
      const session = line.match(SESSION_OPEN);
      if (session) {
        kind = "session";
        openArgs = [session[1], session[2], session[3] || ""];
      } else {
        const run = line.match(RUN_OPEN);
        if (run) {
          kind = "run";
          openArgs = [run[1]];
        } else {
          const result = line.match(RESULT_OPEN);
          if (result) {
            kind = "result";
            openArgs = [result[1]];
          }
        }
      }
    }
    if (!kind) continue;

    let closingIndex = index + 1;
    while (closingIndex < lines.length && !BLOCK_CLOSE.test(lines[closingIndex])) {
      closingIndex += 1;
    }
    if (closingIndex >= lines.length) continue;

    const body = lines.slice(index + 1, closingIndex).join("\n").trim();
    blocks.push({
      kind,
      openLine: index,
      closeLine: closingIndex,
      blockStart: offsets[index],
      blockEnd: offsets[closingIndex] + lines[closingIndex].length,
      openArgs,
      body
    });
    index = closingIndex;
  }
  return blocks;
}

export function parseExecutableNote(markdown: string): ParsedExecutableNote {
  const noteChildren: NoteChildBlock[] = [];
  const sessions: SessionBlock[] = [];
  const runs: RunBlock[] = [];
  const results: ResultBlock[] = [];

  for (const raw of collectDirectiveBlocks(markdown)) {
    if (raw.kind === "note-child") {
      const statusToken = raw.openArgs[0];
      const noteId = raw.openArgs[1] || undefined;
      const statusOverride = raw.openArgs[2];
      // Prefer explicit status=; else first token if it is a known status; else idle
      // (allows :::note-child next as a soft label while still materializing).
      const resolvedStatus: NoteChildStatus = isNoteChildStatus(statusOverride)
        ? statusOverride
        : isNoteChildStatus(statusToken)
          ? statusToken
          : "idle";
      noteChildren.push({
        kind: "note-child",
        index: noteChildren.length,
        line: raw.openLine + 1,
        status: resolvedStatus,
        noteId,
        text: raw.body,
        blockStart: raw.blockStart,
        blockEnd: raw.blockEnd
      });
      continue;
    }

    if (raw.kind === "session") {
      const provider = raw.openArgs[0]?.trim();
      const status = raw.openArgs[1];
      const native = raw.openArgs[2] || undefined;
      if (!provider || !isSessionBlockStatus(status)) continue;
      sessions.push({
        kind: "session",
        index: sessions.length,
        line: raw.openLine + 1,
        provider,
        status,
        native: native || undefined,
        text: raw.body,
        blockStart: raw.blockStart,
        blockEnd: raw.blockEnd
      });
      continue;
    }

    if (raw.kind === "run") {
      const status = raw.openArgs[0];
      if (!isRunBlockStatus(status)) continue;
      runs.push({
        kind: "run",
        index: runs.length,
        line: raw.openLine + 1,
        status,
        text: raw.body,
        blockStart: raw.blockStart,
        blockEnd: raw.blockEnd
      });
      continue;
    }

    if (raw.kind === "result") {
      const status = raw.openArgs[0];
      if (!isResultBlockStatus(status)) continue;
      results.push({
        kind: "result",
        index: results.length,
        line: raw.openLine + 1,
        status,
        text: raw.body,
        blockStart: raw.blockStart,
        blockEnd: raw.blockEnd
      });
    }
  }

  return { noteChildren, sessions, runs, results };
}

export function formatNoteChildBlock(input: {
  status: NoteChildStatus;
  text: string;
  noteId?: string;
}): string {
  const text = input.text.trim();
  const open = input.noteId
    ? `:::note-child ${input.status} note=${input.noteId}`
    : `:::note-child ${input.status}`;
  return `${open}\n${text}\n:::`;
}

export function formatSessionBlock(input: {
  provider: string;
  status: SessionBlockStatus;
  text?: string;
  native?: string;
}): string {
  const provider = input.provider.trim() || "codex";
  const open = input.native
    ? `:::session ${provider} ${input.status} native=${input.native}`
    : `:::session ${provider} ${input.status}`;
  const body = (input.text ?? "").trim();
  // Keep empty bodies as open + close on consecutive lines so sibling blocks are not swallowed.
  return body ? `${open}\n${body}\n:::` : `${open}\n:::`;
}

export function formatRunBlock(input: { status: RunBlockStatus; text?: string }): string {
  const body = (input.text ?? "").trim();
  return body ? `:::run ${input.status}\n${body}\n:::` : `:::run ${input.status}\n:::`;
}

export function formatResultBlock(input: { status: ResultBlockStatus; text: string }): string {
  const text = input.text.trim();
  return `:::result ${input.status}\n${text}\n:::`;
}

/** Default child note body: H1 title + empty session block. */
export function defaultChildNoteBody(title: string, provider = "codex"): string {
  const heading = title.trim() || "Untitled task";
  return `# ${heading}\n\n${formatSessionBlock({ provider, status: "idle", text: "" })}\n`;
}

function replaceBlock(markdown: string, blockStart: number, blockEnd: number, next: string): string {
  return `${markdown.slice(0, blockStart)}${next}${markdown.slice(blockEnd)}`;
}

/**
 * Rewrite note-child blocks from the end so offsets stay valid.
 * `updates` is keyed by note-child index.
 */
export function updateNoteChildBlocks(
  markdown: string,
  updates: ReadonlyMap<number, { status?: NoteChildStatus; noteId?: string; text?: string }>
): string {
  const parsed = parseExecutableNote(markdown);
  let next = markdown;
  const ordered = [...parsed.noteChildren].sort((a, b) => b.blockStart - a.blockStart);
  for (const block of ordered) {
    const patch = updates.get(block.index);
    if (!patch) continue;
    const formatted = formatNoteChildBlock({
      status: patch.status ?? block.status,
      noteId: patch.noteId !== undefined ? patch.noteId : block.noteId,
      text: patch.text ?? block.text
    });
    next = replaceBlock(next, block.blockStart, block.blockEnd, formatted);
  }
  return next;
}

export function updateSessionBlocks(
  markdown: string,
  updates: ReadonlyMap<
    number,
    { provider?: string; status?: SessionBlockStatus; native?: string | null; text?: string }
  >
): string {
  const parsed = parseExecutableNote(markdown);
  let next = markdown;
  const ordered = [...parsed.sessions].sort((a, b) => b.blockStart - a.blockStart);
  for (const block of ordered) {
    const patch = updates.get(block.index);
    if (!patch) continue;
    const native =
      patch.native === null ? undefined : patch.native !== undefined ? patch.native : block.native;
    const formatted = formatSessionBlock({
      provider: patch.provider ?? block.provider,
      status: patch.status ?? block.status,
      native,
      text: patch.text ?? block.text
    });
    next = replaceBlock(next, block.blockStart, block.blockEnd, formatted);
  }
  return next;
}

export function updateRunBlocks(
  markdown: string,
  updates: ReadonlyMap<number, { status?: RunBlockStatus; text?: string }>
): string {
  const parsed = parseExecutableNote(markdown);
  let next = markdown;
  const ordered = [...parsed.runs].sort((a, b) => b.blockStart - a.blockStart);
  for (const block of ordered) {
    const patch = updates.get(block.index);
    if (!patch) continue;
    const formatted = formatRunBlock({
      status: patch.status ?? block.status,
      text: patch.text ?? block.text
    });
    next = replaceBlock(next, block.blockStart, block.blockEnd, formatted);
  }
  return next;
}

export function appendResultBlock(
  markdown: string,
  input: { status: ResultBlockStatus; text: string }
): string {
  const suffix = markdown.trimEnd();
  const block = formatResultBlock(input);
  return suffix ? `${suffix}\n\n${block}\n` : `${block}\n`;
}

/**
 * Pure helper: given parent markdown and a list of newly created child note ids
 * (in document order for unmaterialized blocks only), rewrite those blocks with note=.
 */
export function applyMaterializedNoteIds(
  markdown: string,
  materializations: ReadonlyArray<{ index: number; noteId: string }>
): string {
  const map = new Map<number, { noteId: string; status: NoteChildStatus }>();
  for (const item of materializations) {
    map.set(item.index, { noteId: item.noteId, status: "idle" });
  }
  return updateNoteChildBlocks(markdown, map);
}

export function listUnmaterializedNoteChildren(markdown: string): NoteChildBlock[] {
  return parseExecutableNote(markdown).noteChildren.filter((block) => !block.noteId);
}

export function parseNativeSessionRef(
  native: string | undefined
): { provider: string; sessionId: string } | null {
  if (!native?.trim()) return null;
  const slash = native.indexOf("/");
  if (slash <= 0 || slash >= native.length - 1) return null;
  return {
    provider: native.slice(0, slash),
    sessionId: native.slice(slash + 1)
  };
}

export function formatNativeSessionRef(provider: string, sessionId: string): string {
  return `${provider.trim()}/${sessionId.trim()}`;
}

/** Prefer first run block; used by runtime. */
export function getPrimaryRun(markdown: string): RunBlock | undefined {
  return parseExecutableNote(markdown).runs[0];
}

export function noteChildTitle(block: NoteChildBlock): string {
  return normalizedText(block.text) || `Task ${block.index + 1}`;
}
