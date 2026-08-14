import { getSessionById } from "../catalog/query";
import { CatalogSessionRow, toAgentSession, type AgentProvider, type AgentSession } from "../catalog/types";
import { ensureDesktopDbSchema } from "../catalog/db";
import { llmConfigFromSettings } from "../llm/fromSettings";
import type { AutoTaggingSettings, PanelSettings } from "../settings/types";
import { DEFAULT_SETTINGS } from "../settings/types";
import { escapeSqlLiteral, runSqliteJson } from "../sqlite";
import { resolvePreviewHomes } from "../transcript/homes";
import { loadSessionSnippet } from "../transcript/load";
import { recordLlmUsage } from "../usage/store";
import { getNoteById, listAllNotes, type NoteRecord } from "../notes/catalogNotes";
import { absFromRelMdPath } from "../notes/paths";
import { readNoteFile } from "../notes/fs";
import { parseNoteDocument } from "../notes/frontmatter";
import { clampInt } from "../session/autoSummary";
import { extractTagsFromNote, extractTagsFromSession } from "./extract";
import {
  applyExtractedTags,
  listEntityTags,
  sessionEntityId,
  sweepTagDecay,
  type TagStoreSettings
} from "./store";
import type { EntityTagSummary, TagEntityType } from "./types";

/** Fixed parallel LLM workers per tick (not user-facing). */
export const DEFAULT_AUTO_TAG_CONCURRENCY = 3;
/** Fixed entities processed per 5s tick (not user-facing). */
export const DEFAULT_AUTO_TAG_MAX_PER_TICK = 3;
export const DEFAULT_AUTO_TAG_MAX_TAGS = 6;
export const DEFAULT_AUTO_TAG_QUIET_DELAY_MINUTES = 5;

export interface ResolvedAutoTaggingSettings {
  enabled: boolean;
  halfLifeDays: number;
  pruneThreshold: number;
  maxTagsPerItem: number;
  hitBoost: number;
  consensusFactor: number;
  concurrency: number;
  maxPerTick: number;
  quietDelayMinutes: number;
  quietDelayMs: number;
}

export function resolveAutoTaggingSettings(
  settings?: PanelSettings | null
): ResolvedAutoTaggingSettings {
  const defaults = DEFAULT_SETTINGS.autoTagging || {};
  const raw: AutoTaggingSettings = {
    ...defaults,
    ...(settings?.autoTagging || {})
  };
  const halfLifeDays = clampInt(raw.halfLifeDays, 7, 1, 90);
  // Throughput is fixed: every 5s tick tags up to 3 items with 3 parallel workers.
  const concurrency = DEFAULT_AUTO_TAG_CONCURRENCY;
  const maxTagsPerItem = clampInt(raw.maxTagsPerItem, DEFAULT_AUTO_TAG_MAX_TAGS, 3, 10);
  const maxPerTick = DEFAULT_AUTO_TAG_MAX_PER_TICK;
  const quietDelayMinutes = DEFAULT_AUTO_TAG_QUIET_DELAY_MINUTES;
  return {
    enabled: raw.enabled !== false,
    halfLifeDays,
    pruneThreshold:
      Number.isFinite(raw.pruneThreshold) && (raw.pruneThreshold as number) > 0
        ? Number(raw.pruneThreshold)
        : 0.1,
    maxTagsPerItem,
    hitBoost:
      Number.isFinite(raw.hitBoost) && (raw.hitBoost as number) > 0
        ? Number(raw.hitBoost)
        : 0.5,
    consensusFactor:
      Number.isFinite(raw.consensusFactor) && (raw.consensusFactor as number) > 0
        ? Number(raw.consensusFactor)
        : 0.5,
    concurrency,
    maxPerTick,
    quietDelayMinutes,
    quietDelayMs: quietDelayMinutes * 60_000
  };
}

export function toTagStoreSettings(auto: ResolvedAutoTaggingSettings): TagStoreSettings {
  return {
    halfLifeDays: auto.halfLifeDays,
    pruneThreshold: auto.pruneThreshold,
    hitBoost: auto.hitBoost,
    consensusFactor: auto.consensusFactor
  };
}

export interface TaggingCandidate {
  entityType: TagEntityType;
  entityId: string;
  /** Anchor ms used for quiet-period eligibility. */
  updatedAtMs: number;
  reason: "missing" | "stale";
}

function entityLastTaggedAt(
  rows: Array<{ entity_id: string; last_tagged_at: number }>
): Map<string, number> {
  const map = new Map<string, number>();
  for (const r of rows) {
    map.set(r.entity_id, Number(r.last_tagged_at) || 0);
  }
  return map;
}

/**
 * Sessions that either have no auto tags yet, or were updated after the last auto-tag write.
 */
export async function listSessionsNeedingTags(
  catalogDb: string,
  desktopDb: string,
  poolLimit = 200
): Promise<TaggingCandidate[]> {
  await ensureDesktopDbSchema(desktopDb);
  const limit = Math.max(1, Math.min(poolLimit, 2000));
  const sessions = await runSqliteJson<CatalogSessionRow>(
    catalogDb,
    `SELECT provider, agent_session_id, title, project_path, updated_at_ms, archived,
      message_count, model, branch, source, acp_provider, user_title, hidden, last_synced_at_ms,
      session_summary, session_summary_language, session_summary_at_ms, project_id
     FROM sessions
     WHERE hidden = 0
     ORDER BY updated_at_ms DESC
     LIMIT ${limit};`
  );

  const tagged = await runSqliteJson<{ entity_id: string; last_tagged_at: number }>(
    desktopDb,
    `SELECT entity_id, MAX(updated_at_ms) AS last_tagged_at
     FROM entity_tags
     WHERE entity_type='session' AND source='auto'
     GROUP BY entity_id;`
  );
  const lastMap = entityLastTaggedAt(tagged);

  const out: TaggingCandidate[] = [];
  for (const row of sessions) {
    const session = toAgentSession(row);
    const entityId = sessionEntityId(session.provider, session.id);
    const last = lastMap.get(entityId) || 0;
    const updatedAtMs = Number(session.updatedAt) || 0;
    if (last === 0) {
      out.push({ entityType: "session", entityId, updatedAtMs, reason: "missing" });
    } else if (updatedAtMs > last) {
      out.push({ entityType: "session", entityId, updatedAtMs, reason: "stale" });
    }
  }
  return out;
}

export async function listNotesNeedingTags(
  catalogDb: string,
  desktopDb: string,
  poolLimit = 200
): Promise<TaggingCandidate[]> {
  await ensureDesktopDbSchema(desktopDb);
  const notes = await listAllNotes(catalogDb);
  const tagged = await runSqliteJson<{ entity_id: string; last_tagged_at: number }>(
    desktopDb,
    `SELECT entity_id, MAX(updated_at_ms) AS last_tagged_at
     FROM entity_tags
     WHERE entity_type='note' AND source='auto'
     GROUP BY entity_id;`
  );
  const lastMap = entityLastTaggedAt(tagged);
  const sorted = [...notes].sort((a, b) => b.updatedAtMs - a.updatedAtMs).slice(0, poolLimit);
  const out: TaggingCandidate[] = [];
  for (const note of sorted) {
    const last = lastMap.get(note.noteId) || 0;
    if (last === 0) {
      out.push({
        entityType: "note",
        entityId: note.noteId,
        updatedAtMs: note.updatedAtMs,
        reason: "missing"
      });
    } else if (note.updatedAtMs > last) {
      out.push({
        entityType: "note",
        entityId: note.noteId,
        updatedAtMs: note.updatedAtMs,
        reason: "stale"
      });
    }
  }
  return out;
}

export function selectTaggingCandidates(
  candidates: TaggingCandidate[],
  nowMs: number,
  auto: ResolvedAutoTaggingSettings
): TaggingCandidate[] {
  const eligible = candidates.filter((c) => nowMs >= c.updatedAtMs + auto.quietDelayMs);
  const missing = eligible.filter((c) => c.reason === "missing");
  const stale = eligible.filter((c) => c.reason === "stale");
  return [...missing, ...stale].slice(0, auto.maxPerTick);
}

export interface RunAutoTaggingOptions {
  catalogDb: string;
  desktopDb: string;
  settings: PanelSettings;
  panelHome?: string;
  nowMs?: number;
  systemLocale?: string;
  skipKeys?: Set<string>;
  /** When true, only process sessions. When false-only notes. Default both. */
  entityTypes?: Array<TagEntityType>;
}

export interface RunAutoTaggingResult {
  skippedReason?: "disabled" | "no_llm" | "none_eligible";
  candidates: TaggingCandidate[];
  tagged: number;
  failed: Array<{ key: string; error: string }>;
  decay?: { scanned: number; markedObsolete: number };
}

async function tagOneSession(
  options: {
    catalogDb: string;
    desktopDb: string;
    settings: PanelSettings;
    panelHome?: string;
    systemLocale?: string;
    auto: ResolvedAutoTaggingSettings;
    entityId: string;
  }
): Promise<EntityTagSummary[]> {
  const idx = options.entityId.indexOf(":");
  if (idx <= 0) throw new Error(`Invalid session entity id: ${options.entityId}`);
  const provider = options.entityId.slice(0, idx) as AgentProvider;
  const sessionId = options.entityId.slice(idx + 1);
  const session =
    (await getSessionById(options.catalogDb, provider, sessionId)) ||
    undefined;
  if (!session) throw new Error(`Session not found: ${options.entityId}`);

  const llm = llmConfigFromSettings(options.settings, options.systemLocale);
  if (!llm) throw new Error("LLM is not configured.");

  const homes = resolvePreviewHomes(options.settings, options.panelHome);
  const snippet =
    (await loadSessionSnippet(session, homes, 4_000)) ||
    session.sessionSummary ||
    "";
  const started = Date.now();
  let usage;
  let model: string | undefined;
  try {
    const extracted = await extractTagsFromSession(
      llm,
      {
        title: session.title,
        summary: session.sessionSummary,
        transcriptExcerpt: snippet
      },
      options.auto.maxTagsPerItem
    );
    usage = extracted.usage;
    model = llm.model;
    const tags = await applyExtractedTags(
      options.desktopDb,
      "session",
      options.entityId,
      extracted.tags,
      toTagStoreSettings(options.auto)
    );
    await recordLlmUsage(options.desktopDb, {
      kind: "chat",
      source: "auto_tag",
      jobKey: `tag:session:${options.entityId}`,
      model,
      usage,
      durationMs: Date.now() - started,
      ok: true
    });
    return tags;
  } catch (error) {
    await recordLlmUsage(options.desktopDb, {
      kind: "chat",
      source: "auto_tag",
      jobKey: `tag:session:${options.entityId}`,
      model: llm.model,
      durationMs: Date.now() - started,
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
}

async function tagOneNote(
  options: {
    catalogDb: string;
    desktopDb: string;
    settings: PanelSettings;
    panelHome: string;
    systemLocale?: string;
    auto: ResolvedAutoTaggingSettings;
    noteId: string;
  }
): Promise<EntityTagSummary[]> {
  const note = await getNoteById(options.catalogDb, options.noteId);
  if (!note) throw new Error(`Note not found: ${options.noteId}`);

  const llm = llmConfigFromSettings(options.settings, options.systemLocale);
  if (!llm) throw new Error("LLM is not configured.");

  let body = note.contentPreview || "";
  try {
    const abs = absFromRelMdPath(options.panelHome, note.relMdPath);
    const raw = await readNoteFile(abs);
    const parsed = parseNoteDocument(raw);
    body = parsed.body || raw;
  } catch {
    // fall back to preview
  }

  const started = Date.now();
  try {
    const extracted = await extractTagsFromNote(
      llm,
      {
        title: note.title || note.filename,
        body
      },
      options.auto.maxTagsPerItem
    );
    const tags = await applyExtractedTags(
      options.desktopDb,
      "note",
      options.noteId,
      extracted.tags,
      toTagStoreSettings(options.auto)
    );
    await recordLlmUsage(options.desktopDb, {
      kind: "chat",
      source: "auto_tag",
      jobKey: `tag:note:${options.noteId}`,
      model: llm.model,
      usage: extracted.usage,
      durationMs: Date.now() - started,
      ok: true
    });
    return tags;
  } catch (error) {
    await recordLlmUsage(options.desktopDb, {
      kind: "chat",
      source: "auto_tag",
      jobKey: `tag:note:${options.noteId}`,
      model: llm.model,
      durationMs: Date.now() - started,
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>
): Promise<Array<{ item: T; value?: R; error?: string }>> {
  const results: Array<{ item: T; value?: R; error?: string }> = [];
  let cursor = 0;
  async function run(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor++;
      const item = items[index];
      try {
        const value = await worker(item);
        results[index] = { item, value };
      } catch (error) {
        results[index] = {
          item,
          error: error instanceof Error ? error.message : String(error)
        };
      }
    }
  }
  const workers = Array.from({ length: Math.max(1, concurrency) }, () => run());
  await Promise.all(workers);
  return results;
}

/**
 * Background auto-tag tick: pick eligible sessions/notes, extract tags, apply + consensus.
 * Also runs a lightweight decay sweep at the end of each successful tick.
 */
export async function runAutoTagging(
  options: RunAutoTaggingOptions
): Promise<RunAutoTaggingResult> {
  const auto = resolveAutoTaggingSettings(options.settings);
  if (!auto.enabled) {
    return { skippedReason: "disabled", candidates: [], tagged: 0, failed: [] };
  }
  if (!llmConfigFromSettings(options.settings, options.systemLocale)) {
    return { skippedReason: "no_llm", candidates: [], tagged: 0, failed: [] };
  }

  await ensureDesktopDbSchema(options.desktopDb);
  const nowMs = options.nowMs ?? Date.now();
  const types = options.entityTypes ?? (["session", "note"] as TagEntityType[]);
  const pool: TaggingCandidate[] = [];
  if (types.includes("session")) {
    pool.push(
      ...(await listSessionsNeedingTags(options.catalogDb, options.desktopDb, auto.maxPerTick * 20))
    );
  }
  if (types.includes("note")) {
    pool.push(
      ...(await listNotesNeedingTags(options.catalogDb, options.desktopDb, auto.maxPerTick * 20))
    );
  }

  let candidates = selectTaggingCandidates(pool, nowMs, auto);
  if (options.skipKeys?.size) {
    candidates = candidates.filter(
      (c) => !options.skipKeys!.has(`${c.entityType}:${c.entityId}`)
    );
  }
  if (!candidates.length) {
    // Still run a decay sweep occasionally when nothing to tag
    const decay = await sweepTagDecay(options.desktopDb, toTagStoreSettings(auto));
    return {
      skippedReason: "none_eligible",
      candidates: [],
      tagged: 0,
      failed: [],
      decay
    };
  }

  const panelHome = options.panelHome || "";
  const results = await mapPool(candidates, auto.concurrency, async (c) => {
    if (c.entityType === "session") {
      return tagOneSession({
        catalogDb: options.catalogDb,
        desktopDb: options.desktopDb,
        settings: options.settings,
        panelHome: options.panelHome,
        systemLocale: options.systemLocale,
        auto,
        entityId: c.entityId
      });
    }
    return tagOneNote({
      catalogDb: options.catalogDb,
      desktopDb: options.desktopDb,
      settings: options.settings,
      panelHome,
      systemLocale: options.systemLocale,
      auto,
      noteId: c.entityId
    });
  });

  let tagged = 0;
  const failed: Array<{ key: string; error: string }> = [];
  for (const r of results) {
    const key = `${r.item.entityType}:${r.item.entityId}`;
    if (r.error) {
      failed.push({ key, error: r.error });
    } else {
      tagged += 1;
    }
  }

  const decay = await sweepTagDecay(options.desktopDb, toTagStoreSettings(auto));
  return { candidates, tagged, failed, decay };
}

/** Force-tag a single entity (IPC / MCP manual refresh). */
export async function tagEntityNow(
  options: {
    catalogDb: string;
    desktopDb: string;
    settings: PanelSettings;
    panelHome?: string;
    systemLocale?: string;
    entityType: TagEntityType;
    entityId: string;
  }
): Promise<EntityTagSummary[]> {
  const auto = resolveAutoTaggingSettings(options.settings);
  await ensureDesktopDbSchema(options.desktopDb);
  if (options.entityType === "session") {
    return tagOneSession({
      catalogDb: options.catalogDb,
      desktopDb: options.desktopDb,
      settings: options.settings,
      panelHome: options.panelHome,
      systemLocale: options.systemLocale,
      auto,
      entityId: options.entityId
    });
  }
  return tagOneNote({
    catalogDb: options.catalogDb,
    desktopDb: options.desktopDb,
    settings: options.settings,
    panelHome: options.panelHome || "",
    systemLocale: options.systemLocale,
    auto,
    noteId: options.entityId
  });
}

export async function getEntityTagsForUi(
  desktopDb: string,
  entityType: TagEntityType,
  entityId: string,
  includeObsolete = false
): Promise<EntityTagSummary[]> {
  await ensureDesktopDbSchema(desktopDb);
  return listEntityTags(desktopDb, entityType, entityId, { includeObsolete });
}