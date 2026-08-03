import { escapeSqlLiteral, runSqlite, runSqliteJson } from "../sqlite";

export interface NoteSessionBinding {
  noteId: string;
  provider: string;
  agentSessionId: string;
  role: string;
  runId?: string;
  status: string;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface NoteRunRow {
  runId: string;
  sourceNoteId: string;
  status: string;
  currentChildIndex: number;
  createdAtMs: number;
  updatedAtMs: number;
}

interface BindingRow {
  note_id: string;
  provider: string;
  agent_session_id: string;
  role: string;
  run_id: string | null;
  status: string;
  created_at_ms: number;
  updated_at_ms: number;
}

interface RunRow {
  run_id: string;
  source_note_id: string;
  status: string;
  current_child_index: number;
  created_at_ms: number;
  updated_at_ms: number;
}

function mapBinding(row: BindingRow): NoteSessionBinding {
  return {
    noteId: row.note_id,
    provider: row.provider,
    agentSessionId: row.agent_session_id,
    role: row.role,
    runId: row.run_id || undefined,
    status: row.status,
    createdAtMs: row.created_at_ms,
    updatedAtMs: row.updated_at_ms
  };
}

function mapRun(row: RunRow): NoteRunRow {
  return {
    runId: row.run_id,
    sourceNoteId: row.source_note_id,
    status: row.status,
    currentChildIndex: Number(row.current_child_index) || 0,
    createdAtMs: row.created_at_ms,
    updatedAtMs: row.updated_at_ms
  };
}

export async function upsertNoteSessionBinding(
  dbPath: string,
  binding: {
    noteId: string;
    provider: string;
    agentSessionId: string;
    role?: string;
    runId?: string;
    status?: string;
  }
): Promise<void> {
  const now = Date.now();
  const role = binding.role || "execute";
  const status = binding.status || "linked";
  const runId = binding.runId ? `'${escapeSqlLiteral(binding.runId)}'` : "NULL";
  await runSqlite(
    dbPath,
    `INSERT INTO note_session_bindings (
       note_id, provider, agent_session_id, role, run_id, status, created_at_ms, updated_at_ms
     ) VALUES (
       '${escapeSqlLiteral(binding.noteId)}',
       '${escapeSqlLiteral(binding.provider)}',
       '${escapeSqlLiteral(binding.agentSessionId)}',
       '${escapeSqlLiteral(role)}',
       ${runId},
       '${escapeSqlLiteral(status)}',
       ${now},
       ${now}
     )
     ON CONFLICT(note_id, provider, agent_session_id) DO UPDATE SET
       role = excluded.role,
       run_id = excluded.run_id,
       status = excluded.status,
       updated_at_ms = excluded.updated_at_ms;`
  );
}

export async function listNoteSessionBindings(
  dbPath: string,
  noteId: string
): Promise<NoteSessionBinding[]> {
  const rows = await runSqliteJson<BindingRow>(
    dbPath,
    `SELECT note_id, provider, agent_session_id, role, run_id, status, created_at_ms, updated_at_ms
     FROM note_session_bindings
     WHERE note_id = '${escapeSqlLiteral(noteId)}'
     ORDER BY updated_at_ms DESC;`
  );
  return rows.map(mapBinding);
}

export async function listBindingsForSession(
  dbPath: string,
  provider: string,
  agentSessionId: string
): Promise<NoteSessionBinding[]> {
  const rows = await runSqliteJson<BindingRow>(
    dbPath,
    `SELECT note_id, provider, agent_session_id, role, run_id, status, created_at_ms, updated_at_ms
     FROM note_session_bindings
     WHERE provider = '${escapeSqlLiteral(provider)}'
       AND agent_session_id = '${escapeSqlLiteral(agentSessionId)}'
     ORDER BY updated_at_ms DESC;`
  );
  return rows.map(mapBinding);
}

export async function upsertNoteRun(
  dbPath: string,
  run: {
    runId: string;
    sourceNoteId: string;
    status: string;
    currentChildIndex?: number;
  }
): Promise<void> {
  const now = Date.now();
  const idx = run.currentChildIndex ?? 0;
  await runSqlite(
    dbPath,
    `INSERT INTO note_runs (
       run_id, source_note_id, status, current_child_index, created_at_ms, updated_at_ms
     ) VALUES (
       '${escapeSqlLiteral(run.runId)}',
       '${escapeSqlLiteral(run.sourceNoteId)}',
       '${escapeSqlLiteral(run.status)}',
       ${idx},
       ${now},
       ${now}
     )
     ON CONFLICT(run_id) DO UPDATE SET
       status = excluded.status,
       current_child_index = excluded.current_child_index,
       updated_at_ms = excluded.updated_at_ms;`
  );
}

export async function getNoteRun(dbPath: string, runId: string): Promise<NoteRunRow | undefined> {
  const rows = await runSqliteJson<RunRow>(
    dbPath,
    `SELECT run_id, source_note_id, status, current_child_index, created_at_ms, updated_at_ms
     FROM note_runs WHERE run_id = '${escapeSqlLiteral(runId)}' LIMIT 1;`
  );
  return rows[0] ? mapRun(rows[0]) : undefined;
}

export async function listNoteRunsForSource(
  dbPath: string,
  sourceNoteId: string
): Promise<NoteRunRow[]> {
  const rows = await runSqliteJson<RunRow>(
    dbPath,
    `SELECT run_id, source_note_id, status, current_child_index, created_at_ms, updated_at_ms
     FROM note_runs
     WHERE source_note_id = '${escapeSqlLiteral(sourceNoteId)}'
     ORDER BY created_at_ms DESC;`
  );
  return rows.map(mapRun);
}
