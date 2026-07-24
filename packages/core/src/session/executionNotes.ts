import { escapeSqlLiteral, runSqlite, runSqliteJson } from "../sqlite";
import type { AgentProvider, AgentSession } from "../catalog/types";
import { getSessionById } from "../catalog/query";
import type { NotesStore } from "../notes/store";

export const SESSION_EXECUTION_STATUSES = ["started", "active", "idle", "blocked", "completed"] as const;
export type SessionExecutionStatus = typeof SESSION_EXECUTION_STATUSES[number];

export interface SessionExecutionNoteContext {
  notesStore: NotesStore;
  catalogDb: string;
  desktopDb: string;
}

export interface SessionExecutionNoteRecord {
  provider: AgentProvider;
  sessionId: string;
  noteId: string;
  desktopTracking: boolean;
  lastObservedUpdatedAtMs: number;
  lastActivityLogAtMs: number;
  lastState?: SessionExecutionStatus;
  lastStateAtMs: number;
}

interface ExecutionRow {
  provider: AgentProvider;
  agent_session_id: string;
  note_id: string;
  desktop_tracking: number;
  last_observed_updated_at_ms: number;
  last_activity_log_at_ms: number;
  last_state: string | null;
  last_state_at_ms: number;
}

export interface ExecutionCheckpointInput {
  provider: AgentProvider;
  sessionId: string;
  status: SessionExecutionStatus;
  description?: string;
  source: "desktop" | "mcp";
  nowMs?: number;
  desktopTracking?: boolean;
  observedUpdatedAtMs?: number;
}

function mapRow(row: ExecutionRow): SessionExecutionNoteRecord {
  const status = SESSION_EXECUTION_STATUSES.includes(row.last_state as SessionExecutionStatus)
    ? row.last_state as SessionExecutionStatus
    : undefined;
  return {
    provider: row.provider,
    sessionId: row.agent_session_id,
    noteId: row.note_id,
    desktopTracking: row.desktop_tracking === 1,
    lastObservedUpdatedAtMs: Number(row.last_observed_updated_at_ms) || 0,
    lastActivityLogAtMs: Number(row.last_activity_log_at_ms) || 0,
    lastState: status,
    lastStateAtMs: Number(row.last_state_at_ms) || 0
  };
}

function cleanDescription(value: string | undefined): string {
  return (value || "").replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 2_000);
}

function timelineLine(input: ExecutionCheckpointInput, atMs: number): string {
  const label = new Date(atMs).toISOString();
  const description = cleanDescription(input.description);
  return `- ${label} | ${input.status} | ${input.source}${description ? ` | ${description}` : ""}`;
}

async function loadRecord(
  desktopDb: string,
  provider: AgentProvider,
  sessionId: string
): Promise<SessionExecutionNoteRecord | undefined> {
  const rows = await runSqliteJson<ExecutionRow>(
    desktopDb,
    `SELECT provider, agent_session_id, note_id, desktop_tracking, last_observed_updated_at_ms,
      last_activity_log_at_ms, last_state, last_state_at_ms
     FROM session_execution_notes
     WHERE provider='${escapeSqlLiteral(provider)}'
       AND agent_session_id='${escapeSqlLiteral(sessionId)}'
     LIMIT 1;`
  );
  return rows[0] ? mapRow(rows[0]) : undefined;
}

async function upsertRecord(
  desktopDb: string,
  record: SessionExecutionNoteRecord,
  nowMs: number
): Promise<void> {
  await runSqlite(
    desktopDb,
    `INSERT INTO session_execution_notes (
       provider, agent_session_id, note_id, desktop_tracking,
       last_observed_updated_at_ms, last_activity_log_at_ms, last_state, last_state_at_ms,
       created_at_ms, updated_at_ms
     ) VALUES (
       '${escapeSqlLiteral(record.provider)}', '${escapeSqlLiteral(record.sessionId)}',
       '${escapeSqlLiteral(record.noteId)}', ${record.desktopTracking ? 1 : 0},
       ${Math.max(0, Math.floor(record.lastObservedUpdatedAtMs))},
       ${Math.max(0, Math.floor(record.lastActivityLogAtMs))},
       ${record.lastState ? `'${escapeSqlLiteral(record.lastState)}'` : "NULL"},
       ${Math.max(0, Math.floor(record.lastStateAtMs))}, ${Math.floor(nowMs)}, ${Math.floor(nowMs)}
     ) ON CONFLICT(provider, agent_session_id) DO UPDATE SET
       note_id=excluded.note_id,
       desktop_tracking=excluded.desktop_tracking,
       last_observed_updated_at_ms=excluded.last_observed_updated_at_ms,
       last_activity_log_at_ms=excluded.last_activity_log_at_ms,
       last_state=excluded.last_state,
       last_state_at_ms=excluded.last_state_at_ms,
       updated_at_ms=excluded.updated_at_ms;`
  );
}

async function resolveSession(
  ctx: SessionExecutionNoteContext,
  provider: AgentProvider,
  sessionId: string
): Promise<AgentSession> {
  const session = await getSessionById(ctx.catalogDb, provider, sessionId);
  if (!session) {
    throw new Error(`Session not found: ${provider} ${sessionId}`);
  }
  return session;
}

async function ensureExecutionNote(
  ctx: SessionExecutionNoteContext,
  input: ExecutionCheckpointInput,
  nowMs: number
): Promise<{ session: AgentSession; record: SessionExecutionNoteRecord }> {
  const session = await resolveSession(ctx, input.provider, input.sessionId);
  const current = await loadRecord(ctx.desktopDb, input.provider, input.sessionId);
  if (current && await ctx.notesStore.getNote(current.noteId)) {
    return { session, record: current };
  }

  const content = [
    "# Session execution record",
    "",
    "System-managed timeline. This note is read-only in Agent Resume.",
    ""
  ].join("\n");
  const note = await ctx.notesStore.createSessionNote(session, content);
  return {
    session,
    record: {
      provider: input.provider,
      sessionId: input.sessionId,
      noteId: note.noteId,
      desktopTracking: input.desktopTracking === true,
      lastObservedUpdatedAtMs: 0,
      lastActivityLogAtMs: 0,
      lastStateAtMs: 0
    }
  };
}

export async function isManagedExecutionNote(desktopDb: string, noteId: string): Promise<boolean> {
  const rows = await runSqliteJson<{ note_id: string }>(
    desktopDb,
    `SELECT note_id FROM session_execution_notes
     WHERE note_id='${escapeSqlLiteral(noteId)}' LIMIT 1;`
  );
  return Boolean(rows[0]);
}

export async function assertExecutionNoteWritable(desktopDb: string, noteId: string): Promise<void> {
  if (await isManagedExecutionNote(desktopDb, noteId)) {
    throw new Error("Session execution records are system-managed and cannot be edited manually.");
  }
}

export async function appendSessionExecutionCheckpoint(
  ctx: SessionExecutionNoteContext,
  input: ExecutionCheckpointInput
): Promise<SessionExecutionNoteRecord> {
  const nowMs = input.nowMs ?? Date.now();
  const { record } = await ensureExecutionNote(ctx, input, nowMs);
  const content = await ctx.notesStore.readNoteContent(record.noteId);
  await ctx.notesStore.writeNoteContent(record.noteId, `${content.replace(/\s*$/, "")}\n${timelineLine(input, nowMs)}\n`);
  const next: SessionExecutionNoteRecord = {
    ...record,
    desktopTracking: record.desktopTracking || input.desktopTracking === true,
    lastObservedUpdatedAtMs: Math.max(record.lastObservedUpdatedAtMs, Number(input.observedUpdatedAtMs) || 0),
    lastActivityLogAtMs: input.status === "active" ? nowMs : record.lastActivityLogAtMs,
    lastState: input.status,
    lastStateAtMs: nowMs
  };
  await upsertRecord(ctx.desktopDb, next, nowMs);
  return next;
}

export async function startDesktopExecutionTracking(
  ctx: SessionExecutionNoteContext,
  session: Pick<AgentSession, "provider" | "id" | "updatedAt">
): Promise<SessionExecutionNoteRecord> {
  return appendSessionExecutionCheckpoint(ctx, {
    provider: session.provider,
    sessionId: session.id,
    status: "started",
    source: "desktop",
    desktopTracking: true,
    observedUpdatedAtMs: session.updatedAt
  });
}

export async function recordTrackedExecutionActivity(
  ctx: SessionExecutionNoteContext,
  session: Pick<AgentSession, "provider" | "id" | "updatedAt">,
  options: { nowMs?: number; minLogIntervalMs?: number } = {}
): Promise<SessionExecutionNoteRecord | undefined> {
  const record = await loadRecord(ctx.desktopDb, session.provider, session.id);
  if (!record?.desktopTracking || session.updatedAt <= record.lastObservedUpdatedAtMs) return undefined;
  const nowMs = options.nowMs ?? Date.now();
  const minLogIntervalMs = options.minLogIntervalMs ?? 5 * 60_000;
  if (nowMs - record.lastActivityLogAtMs < minLogIntervalMs) {
    const next = { ...record, lastObservedUpdatedAtMs: session.updatedAt };
    await upsertRecord(ctx.desktopDb, next, nowMs);
    return next;
  }
  return appendSessionExecutionCheckpoint(ctx, {
    provider: session.provider,
    sessionId: session.id,
    status: "active",
    source: "desktop",
    observedUpdatedAtMs: session.updatedAt,
    nowMs
  });
}

export async function recordTrackedExecutionIdle(
  ctx: SessionExecutionNoteContext,
  options: { nowMs?: number; idleAfterMs?: number } = {}
): Promise<number> {
  const nowMs = options.nowMs ?? Date.now();
  const idleAfterMs = options.idleAfterMs ?? 10 * 60_000;
  const rows = await runSqliteJson<ExecutionRow>(
    ctx.desktopDb,
    `SELECT provider, agent_session_id, note_id, desktop_tracking, last_observed_updated_at_ms,
      last_activity_log_at_ms, last_state, last_state_at_ms
     FROM session_execution_notes WHERE desktop_tracking=1;`
  );
  let count = 0;
  for (const row of rows) {
    const record = mapRow(row);
    if (["idle", "blocked", "completed"].includes(record.lastState || "")) continue;
    const lastActivityAtMs = Math.max(record.lastObservedUpdatedAtMs, record.lastStateAtMs);
    if (nowMs - lastActivityAtMs < idleAfterMs) continue;
    await appendSessionExecutionCheckpoint(ctx, {
      provider: record.provider,
      sessionId: record.sessionId,
      status: "idle",
      source: "desktop",
      nowMs
    });
    count += 1;
  }
  return count;
}
