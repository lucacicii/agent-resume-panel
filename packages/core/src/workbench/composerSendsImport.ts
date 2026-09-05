import type { AgentSession } from "../catalog/types";
import { escapeSqlLiteral, runSqlite } from "../sqlite";
import { loadSessionPreview } from "../transcript/load";
import type { PreviewHomes } from "../transcript/types";
import { appendComposerSend, listComposerSendsForImport } from "./composerSends";
import { filterComposerImportCandidates, isComposerSendNoise } from "./composerSendNoise";

const IMPORT_PANE_PREFIX = "import:";

function importPaneKey(provider: string, sessionId: string): string {
  return `${IMPORT_PANE_PREFIX}${provider}:${sessionId}`;
}

function parseTimestampMs(value?: string | number | null): number | undefined {
  if (value == null) return undefined;
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  const num = Number(value);
  if (Number.isFinite(num) && num > 0) return num;
  const parsed = Date.parse(String(value));
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return undefined;
}

/**
 * Decide whether a parsed user message belongs in the composer send log.
 * Full-length transcript dumps are excluded here; only short reusable
 * instructions pass. Wrapper/CLI echoes are dropped as noise. Burst-level
 * filtering happens later in filterComposerImportCandidates.
 */
const SYSTEM_INJECTION =
  /^(?:<INSTRUCTIONS?>[\s\S]*|<environment_context>[\s\S]*|# AGENTS\.md instructions[\s\S]*)/i;
const TOOL_RESULT_ECHO =
  /^(?:Tool ran without output or errors|Exit code \d+|Command output|stdout|stderr|\[tool|Tool (?:result|output|call|use)|<tool)/i;
const RAW_STACK_LINE =
  /^(?:\s*at\s+\S+\s*\(|\s*at\s+\S+$|Uncaught Error|Minified React error|node:internal\/\S+)|\bUncaught Error\b|\bMinified React error\b/;
const ERROR_TELEMETRY = /^\/var\/folders\//;
const AGENTS_INJECTION = /^# AGENTS\.md instructions[\s\S]*$/i;

export function shouldImportComposerSendText(text: string): boolean {
  const trimmed = text?.trim() ?? "";
  if (!trimmed || trimmed.length < 2) return false;
  if (trimmed.length > 500) return false;
  if (isComposerSendNoise(trimmed)) return false;
  // Provider-injected context, not something the user typed in wb-terminal-composer.
  if (SYSTEM_INJECTION.test(trimmed)) return false;
  if (TOOL_RESULT_ECHO.test(trimmed)) return false;
  if (RAW_STACK_LINE.test(trimmed)) return false;
  if (ERROR_TELEMETRY.test(trimmed)) return false;
  if (AGENTS_INJECTION.test(trimmed)) return false;
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
 * Import the full historical user inputs of one agent session into
 * workbench_composer_sends so the session composer shows them as tips.
 *
 * Full-transcript mode: never truncates at 100 messages. Candidates are
 * filtered through the shared composer noise rules plus terminal-burst
 * detection, then deduped exactly on (provider, agent_session_id, text)
 * so repeated imports are always no-ops.
 */
export async function importComposerSendsForSession(
  dbPath: string,
  session: AgentSession,
  homes: PreviewHomes
): Promise<ImportComposerSendsResult> {
  let preview;
  try {
    preview = await loadSessionPreview(session, homes, { maxMessages: Infinity });
  } catch {
    return { imported: 0, skipped: 0, found: 0 };
  }

  if (!preview.messages.length) {
    return { imported: 0, skipped: 0, found: 0 };
  }

  // Unbounded (no COMPOSER_SEND_LIST_MAX=100 cap): import must see every
  // existing row for the session, or repeated imports snowball again.
  const existing = await listComposerSendsForImport(dbPath, {
    includeTipRows: true,
    provider: session.provider,
    agentSessionId: session.id
  });
  const importedKeys = new Set(
    existing.map((record) => `${record.provider ?? ""}::${record.agentSessionId ?? ""}::${record.text}`)
  );
  const liveKeys = new Set(
    existing
      .filter((record) => !String(record.paneKey ?? "").startsWith(IMPORT_PANE_PREFIX))
      .map((record) => `${record.provider ?? ""}::${record.agentSessionId ?? ""}::${record.text}`)
  );

  const projectPath = session.projectPath?.trim() || "";
  const paneKey = importPaneKey(session.provider, session.id);

  let found = 0;
  const raw: Array<{ text: string; createdAtMs: number }> = [];
  for (const message of preview.messages) {
    if (message.role !== "user") continue;
    const text = message.text?.trim();
    if (!text) continue;
    found += 1;
    if (!shouldImportComposerSendText(text)) continue;
    const messageTime =
      parseTimestampMs(message.timestamp) || session.updatedAt || Date.now();
    raw.push({ text, createdAtMs: messageTime });
  }

  const candidates = filterComposerImportCandidates(raw);

  let imported = 0;
  let skipped = 0;
  for (const candidate of candidates) {
    const key = `${session.provider}::${session.id}::${candidate.text}`;
    if (importedKeys.has(key) || liveKeys.has(key)) {
      skipped += 1;
      continue;
    }
    try {
      const record = await appendComposerSend(dbPath, {
        paneKey,
        projectPath,
        provider: session.provider,
        agentSessionId: session.id,
        text: candidate.text,
        createdAtMs: candidate.createdAtMs
      });
      importedKeys.add(key);
      void record;
      imported += 1;
    } catch {
      skipped += 1;
    }
  }
  const filteredOut = found - raw.length;
  skipped += filteredOut > 0 ? filteredOut : 0;
  return { imported, skipped, found };
}

export interface CleanupComposerSendsResult {
  deletedDuplicates: number;
  deletedNoise: number;
  deletedLiveConflicts: number;
  keptLiveRows: number;
}

/**
 * One-shot repair for the polluted composer log: drop non-import rows never,
 * dedupe import rows keeping one copy per text, delete noise rows, and drop
 * import rows that shadow an identical live composer send.
 */
export async function cleanupImportedComposerSends(
  dbPath: string
): Promise<CleanupComposerSendsResult> {
  const all = await listComposerSendsForImport(dbPath, { includeTipRows: true });
  const groups = new Map<string, typeof all>();
  for (const row of all) {
    const key = `${row.provider ?? ""}::${row.agentSessionId ?? ""}::${row.text}`;
    const bucket = groups.get(key) ?? [];
    bucket.push(row);
    groups.set(key, bucket);
  }

  const duplicateIds: string[] = [];
  const noiseIds: string[] = [];
  const liveConflictIds: string[] = [];

  for (const [, bucket] of groups) {
    bucket.sort((a, b) => a.createdAtMs - b.createdAtMs || a.id.localeCompare(b.id));
    const representative = bucket[0];
    // Cleanup uses the same admission rule as import: anything import would
    // reject (noise, injected context, tool echoes, >500 chars) is garbage.
    if (isComposerSendNoise(representative.text) || !shouldImportComposerSendText(representative.text)) {
      noiseIds.push(...bucket.map((row) => row.id));
      continue;
    }
    const live = bucket.filter((row) => !String(row.paneKey ?? "").startsWith(IMPORT_PANE_PREFIX));
    const imports = bucket.filter((row) => String(row.paneKey ?? "").startsWith(IMPORT_PANE_PREFIX));
    if (live.length > 0) {
      liveConflictIds.push(...imports.map((row) => row.id));
      if (imports.length > 0) {
        // Keep zero import copies when a live twin exists.
      }
    } else if (imports.length > 1) {
      duplicateIds.push(...imports.slice(1).map((row) => row.id));
    }
  }

  const keptLiveRows = all.filter(
    (row) => !String(row.paneKey ?? "").startsWith(IMPORT_PANE_PREFIX)
  ).length;

  const deleteByIds = async (ids: string[]): Promise<number> => {
    if (!ids.length) return 0;
    const CHUNK = 200;
    let deleted = 0;
    for (let i = 0; i < ids.length; i += CHUNK) {
      const chunk = ids.slice(i, i + CHUNK);
      const list = chunk.map((id) => `'${escapeSqlLiteral(id)}'`).join(",");
      await runSqlite(
        dbPath,
        `DELETE FROM workbench_composer_sends WHERE id IN (${list});`
      );
      deleted += chunk.length;
    }
    return deleted;
  };

  return {
    deletedDuplicates: await deleteByIds(Array.from(new Set(duplicateIds))),
    deletedNoise: await deleteByIds(Array.from(new Set(noiseIds))),
    deletedLiveConflicts: await deleteByIds(Array.from(new Set(liveConflictIds))),
    keptLiveRows
  };
}
