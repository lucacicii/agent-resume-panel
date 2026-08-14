import { randomUUID } from "node:crypto";
import { escapeSqlLiteral, runSqlite, runSqliteJson, runSqliteTransaction } from "../sqlite";
import {
  computeDecayedWeight,
  DEFAULT_CONSENSUS_FACTOR,
  DEFAULT_HALF_LIFE_DAYS,
  DEFAULT_HIT_BOOST,
  DEFAULT_PRUNE_THRESHOLD,
  determineTagStatus,
  normalizeCategory,
  normalizeTagName
} from "./decay";
import type {
  EntityTagRow,
  EntityTagSummary,
  ExtractedTag,
  TagCategory,
  TagDefinitionRow,
  TagEntityHitItem,
  TagEntityType,
  TagFilterOptions,
  TagSource,
  TagStatus
} from "./types";

export interface TagStoreSettings {
  halfLifeDays?: number;
  pruneThreshold?: number;
  hitBoost?: number;
  consensusFactor?: number;
}

function nowMs(): number {
  return Date.now();
}

function entityTagId(entityType: TagEntityType, entityId: string, normalizedTag: string): string {
  return `${entityType}:${entityId}:${normalizedTag}`;
}

function displayNameFromNormalized(normalized: string, original?: string): string {
  if (original && original.trim()) return original.trim().slice(0, 80);
  return normalized
    .split(/[\s._-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

async function loadEntityTag(
  dbPath: string,
  entityType: TagEntityType,
  entityId: string,
  normalizedTag: string
): Promise<EntityTagRow | undefined> {
  const rows = await runSqliteJson<EntityTagRow>(
    dbPath,
    `SELECT * FROM entity_tags
     WHERE entity_type='${escapeSqlLiteral(entityType)}'
       AND entity_id='${escapeSqlLiteral(entityId)}'
       AND normalized_tag='${escapeSqlLiteral(normalizedTag)}'
     LIMIT 1;`
  );
  return rows[0];
}

async function countActiveEntitiesForTag(dbPath: string, normalizedTag: string): Promise<{
  total: number;
  sessions: number;
  notes: number;
}> {
  const rows = await runSqliteJson<{ entity_type: string; c: number }>(
    dbPath,
    `SELECT entity_type, COUNT(*) AS c
     FROM entity_tags
     WHERE normalized_tag='${escapeSqlLiteral(normalizedTag)}'
       AND status='active'
     GROUP BY entity_type;`
  );
  let sessions = 0;
  let notes = 0;
  for (const r of rows) {
    if (r.entity_type === "session") sessions = Number(r.c) || 0;
    if (r.entity_type === "note") notes = Number(r.c) || 0;
  }
  return { total: sessions + notes, sessions, notes };
}

/**
 * Recompute consensus_count for all entity_tags sharing a normalized_tag,
 * then refresh weight/status for each.
 */
async function refreshConsensusForTag(
  dbPath: string,
  normalizedTag: string,
  settings: TagStoreSettings = {}
): Promise<void> {
  const counts = await countActiveEntitiesForTag(dbPath, normalizedTag);
  const consensusCount = Math.max(1, counts.total);
  const halfLifeDays = settings.halfLifeDays ?? DEFAULT_HALF_LIFE_DAYS;
  const pruneThreshold = settings.pruneThreshold ?? DEFAULT_PRUNE_THRESHOLD;
  const hitBoost = settings.hitBoost ?? DEFAULT_HIT_BOOST;
  const consensusFactor = settings.consensusFactor ?? DEFAULT_CONSENSUS_FACTOR;
  const now = nowMs();

  const entities = await runSqliteJson<EntityTagRow>(
    dbPath,
    `SELECT * FROM entity_tags WHERE normalized_tag='${escapeSqlLiteral(normalizedTag)}';`
  );

  const statements: string[] = [];
  let activeCount = 0;
  let totalHits = 0;
  let sessionCount = 0;
  let noteCount = 0;
  let maxWeight = 0;
  let displayName = normalizedTag;
  let category: TagCategory = "tech_stack";

  for (const row of entities) {
    // Soft-obsolete bindings stay obsolete until re-extracted or hit-reactivated.
    // Consensus refresh must not resurrect LLM-removed / user-removed tags.
    if ((row.status as TagStatus) === "obsolete") {
      totalHits += row.hit_count || 0;
      displayName = row.tag || displayName;
      category = (row.category as TagCategory) || category;
      statements.push(
        `UPDATE entity_tags SET
           consensus_count=${consensusCount},
           updated_at_ms=${now}
         WHERE id='${escapeSqlLiteral(row.id)}';`
      );
      continue;
    }

    const weight = computeDecayedWeight({
      baseWeight: row.source === "manual" ? 2.0 : 1.0,
      consensusCount,
      hitCount: row.hit_count,
      hitBoost,
      consensusFactor,
      lastDecayAtMs: row.last_decay_at_ms || row.created_at_ms,
      nowMs: now,
      halfLifeDays,
      source: row.source as TagSource
    });
    const status = determineTagStatus({
      weight,
      pruneThreshold,
      lastHitAtMs: row.last_hit_at_ms || row.created_at_ms,
      nowMs: now,
      source: row.source as TagSource
    });
    const obsoleteAt =
      status === "obsolete"
        ? row.obsolete_at_ms ?? now
        : null;

    if (status === "active") {
      activeCount += 1;
      if (row.entity_type === "session") sessionCount += 1;
      if (row.entity_type === "note") noteCount += 1;
    }
    totalHits += row.hit_count || 0;
    maxWeight = Math.max(maxWeight, weight);
    displayName = row.tag || displayName;
    category = (row.category as TagCategory) || category;

    statements.push(
      `UPDATE entity_tags SET
         consensus_count=${consensusCount},
         weight=${weight},
         status='${status}',
         updated_at_ms=${now},
         last_decay_at_ms=${now},
         obsolete_at_ms=${obsoleteAt === null ? "NULL" : obsoleteAt}
       WHERE id='${escapeSqlLiteral(row.id)}';`
    );
  }

  const defStatus: TagStatus = activeCount > 0 ? "active" : "obsolete";
  statements.push(
    `INSERT INTO tag_definitions (
       normalized_tag, display_name, category,
       session_count, note_count, active_entity_count, total_hits,
       global_weight, status, pinned, created_at_ms, updated_at_ms
     ) VALUES (
       '${escapeSqlLiteral(normalizedTag)}',
       '${escapeSqlLiteral(displayNameFromNormalized(normalizedTag, displayName))}',
       '${escapeSqlLiteral(category)}',
       ${sessionCount}, ${noteCount}, ${activeCount}, ${totalHits},
       ${Math.max(0.1, maxWeight)}, '${defStatus}', 0, ${now}, ${now}
     )
     ON CONFLICT(normalized_tag) DO UPDATE SET
       display_name=excluded.display_name,
       category=excluded.category,
       session_count=excluded.session_count,
       note_count=excluded.note_count,
       active_entity_count=excluded.active_entity_count,
       total_hits=excluded.total_hits,
       global_weight=excluded.global_weight,
       status=CASE WHEN tag_definitions.pinned=1 THEN 'active' ELSE excluded.status END,
       updated_at_ms=excluded.updated_at_ms;`
  );

  if (statements.length > 0) {
    await runSqliteTransaction(dbPath, statements);
  }
}

/**
 * Upsert extracted tags onto a Session or Note. Replaces auto tags that were not re-emitted;
 * preserves manual tags. Cascades consensus refresh for every affected tag.
 */
export async function applyExtractedTags(
  dbPath: string,
  entityType: TagEntityType,
  entityId: string,
  tags: ExtractedTag[],
  settings: TagStoreSettings = {}
): Promise<EntityTagSummary[]> {
  const now = nowMs();
  const normalizedIncoming = tags
    .map((t) => ({
      tag: (t.tag || "").trim(),
      normalized: normalizeTagName(t.tag),
      category: normalizeCategory(t.category),
      confidence: Number.isFinite(t.confidence) ? Math.max(0.1, Math.min(1, Number(t.confidence))) : 1.0
    }))
    .filter((t) => t.normalized);

  const existing = await runSqliteJson<EntityTagRow>(
    dbPath,
    `SELECT * FROM entity_tags
     WHERE entity_type='${escapeSqlLiteral(entityType)}'
       AND entity_id='${escapeSqlLiteral(entityId)}';`
  );

  const existingByNorm = new Map(existing.map((r) => [r.normalized_tag, r]));
  const incomingNorms = new Set(normalizedIncoming.map((t) => t.normalized));
  const affectedTags = new Set<string>();

  const statements: string[] = [];

  for (const item of normalizedIncoming) {
    const prev = existingByNorm.get(item.normalized);
    const id = prev?.id || entityTagId(entityType, entityId, item.normalized);
    const baseWeight = item.confidence;
    if (prev) {
      // Refresh auto tags; leave manual source intact
      const source = prev.source === "manual" ? "manual" : "auto";
      const weight = source === "manual" ? Math.max(prev.weight, 2.0) : baseWeight;
      statements.push(
        `UPDATE entity_tags SET
           tag='${escapeSqlLiteral(item.tag || prev.tag)}',
           category='${escapeSqlLiteral(item.category)}',
           weight=${weight},
           status='active',
           source='${source}',
           updated_at_ms=${now},
           last_hit_at_ms=${now},
           last_decay_at_ms=${now},
           obsolete_at_ms=NULL
         WHERE id='${escapeSqlLiteral(id)}';`
      );
    } else {
      statements.push(
        `INSERT INTO entity_tags (
           id, entity_type, entity_id, tag, normalized_tag, category,
           weight, hit_count, consensus_count, status, source,
           created_at_ms, updated_at_ms, last_hit_at_ms, last_decay_at_ms, obsolete_at_ms
         ) VALUES (
           '${escapeSqlLiteral(id)}',
           '${escapeSqlLiteral(entityType)}',
           '${escapeSqlLiteral(entityId)}',
           '${escapeSqlLiteral(item.tag || item.normalized)}',
           '${escapeSqlLiteral(item.normalized)}',
           '${escapeSqlLiteral(item.category)}',
           ${baseWeight}, 0, 1, 'active', 'auto',
           ${now}, ${now}, ${now}, ${now}, NULL
         );`
      );
    }
    affectedTags.add(item.normalized);
  }

  // Soft-obsolete auto tags that the LLM no longer emits (manual tags stay)
  for (const prev of existing) {
    if (prev.source === "manual") continue;
    if (incomingNorms.has(prev.normalized_tag)) continue;
    if (prev.status === "obsolete") continue;
    statements.push(
      `UPDATE entity_tags SET
         status='obsolete',
         obsolete_at_ms=${now},
         updated_at_ms=${now}
       WHERE id='${escapeSqlLiteral(prev.id)}';`
    );
    affectedTags.add(prev.normalized_tag);
  }

  if (statements.length > 0) {
    await runSqliteTransaction(dbPath, statements);
  }

  for (const tag of affectedTags) {
    await refreshConsensusForTag(dbPath, tag, settings);
  }

  return listEntityTags(dbPath, entityType, entityId, { includeObsolete: false });
}

/**
 * Manually add (or boost) a tag on an entity. Manual tags do not decay.
 */
export async function addManualTag(
  dbPath: string,
  entityType: TagEntityType,
  entityId: string,
  tag: string,
  category?: string,
  settings: TagStoreSettings = {}
): Promise<EntityTagSummary | undefined> {
  const normalized = normalizeTagName(tag);
  if (!normalized) return undefined;
  const cat = normalizeCategory(category);
  const now = nowMs();
  const prev = await loadEntityTag(dbPath, entityType, entityId, normalized);
  const id = prev?.id || entityTagId(entityType, entityId, normalized);
  const display = tag.trim().slice(0, 80) || normalized;

  if (prev) {
    const nextWeight = Math.max(Number(prev.weight) || 0, 2.0);
    await runSqlite(
      dbPath,
      `UPDATE entity_tags SET
         tag='${escapeSqlLiteral(display)}',
         category='${escapeSqlLiteral(cat)}',
         weight=${nextWeight},
         status='active',
         source='manual',
         updated_at_ms=${now},
         last_hit_at_ms=${now},
         last_decay_at_ms=${now},
         obsolete_at_ms=NULL
       WHERE id='${escapeSqlLiteral(id)}';`
    );
  } else {
    await runSqlite(
      dbPath,
      `INSERT INTO entity_tags (
         id, entity_type, entity_id, tag, normalized_tag, category,
         weight, hit_count, consensus_count, status, source,
         created_at_ms, updated_at_ms, last_hit_at_ms, last_decay_at_ms, obsolete_at_ms
       ) VALUES (
         '${escapeSqlLiteral(id)}',
         '${escapeSqlLiteral(entityType)}',
         '${escapeSqlLiteral(entityId)}',
         '${escapeSqlLiteral(display)}',
         '${escapeSqlLiteral(normalized)}',
         '${escapeSqlLiteral(cat)}',
         2.0, 0, 1, 'active', 'manual',
         ${now}, ${now}, ${now}, ${now}, NULL
       );`
    );
  }

  await refreshConsensusForTag(dbPath, normalized, settings);
  const tags = await listEntityTags(dbPath, entityType, entityId, { includeObsolete: true });
  return tags.find((t) => t.normalizedTag === normalized);
}

/**
 * Remove a tag from an entity. Default is soft-obsolete; hardDelete physically deletes the row.
 */
export async function removeEntityTag(
  dbPath: string,
  entityType: TagEntityType,
  entityId: string,
  tag: string,
  hardDelete = false,
  settings: TagStoreSettings = {}
): Promise<boolean> {
  const normalized = normalizeTagName(tag);
  if (!normalized) return false;
  const prev = await loadEntityTag(dbPath, entityType, entityId, normalized);
  if (!prev) return false;
  const now = nowMs();

  if (hardDelete) {
    await runSqlite(dbPath, `DELETE FROM entity_tags WHERE id='${escapeSqlLiteral(prev.id)}';`);
  } else {
    await runSqlite(
      dbPath,
      `UPDATE entity_tags SET
         status='obsolete',
         obsolete_at_ms=${now},
         updated_at_ms=${now}
       WHERE id='${escapeSqlLiteral(prev.id)}';`
    );
  }

  await refreshConsensusForTag(dbPath, normalized, settings);
  return true;
}

/**
 * Record a recall/open hit on every active tag of an entity. Reactivates obsolete tags.
 */
export async function recordEntityTagHits(
  dbPath: string,
  entityType: TagEntityType,
  entityId: string,
  settings: TagStoreSettings = {}
): Promise<number> {
  const rows = await runSqliteJson<EntityTagRow>(
    dbPath,
    `SELECT * FROM entity_tags
     WHERE entity_type='${escapeSqlLiteral(entityType)}'
       AND entity_id='${escapeSqlLiteral(entityId)}';`
  );
  if (rows.length === 0) return 0;

  const now = nowMs();
  const hitBoost = settings.hitBoost ?? DEFAULT_HIT_BOOST;
  const halfLifeDays = settings.halfLifeDays ?? DEFAULT_HALF_LIFE_DAYS;
  const consensusFactor = settings.consensusFactor ?? DEFAULT_CONSENSUS_FACTOR;
  const pruneThreshold = settings.pruneThreshold ?? DEFAULT_PRUNE_THRESHOLD;
  const affected = new Set<string>();
  const statements: string[] = [];

  for (const row of rows) {
    const hitCount = (row.hit_count || 0) + 1;
    const weight = computeDecayedWeight({
      baseWeight: row.source === "manual" ? 2.0 : 1.0,
      consensusCount: row.consensus_count || 1,
      hitCount,
      hitBoost,
      consensusFactor,
      lastDecayAtMs: now,
      nowMs: now,
      halfLifeDays,
      source: row.source as TagSource
    });
    const status = determineTagStatus({
      weight,
      pruneThreshold,
      lastHitAtMs: now,
      nowMs: now,
      source: row.source as TagSource
    });
    statements.push(
      `UPDATE entity_tags SET
         hit_count=${hitCount},
         weight=${weight},
         status='${status}',
         updated_at_ms=${now},
         last_hit_at_ms=${now},
         last_decay_at_ms=${now},
         obsolete_at_ms=${status === "obsolete" ? now : "NULL"}
       WHERE id='${escapeSqlLiteral(row.id)}';`
    );
    affected.add(row.normalized_tag);
  }

  if (statements.length > 0) {
    await runSqliteTransaction(dbPath, statements);
  }
  for (const tag of affected) {
    await refreshConsensusForTag(dbPath, tag, settings);
  }
  return rows.length;
}

/**
 * Sweep all entity tags: recompute decayed weight and mark obsolete when below threshold.
 */
export async function sweepTagDecay(
  dbPath: string,
  settings: TagStoreSettings = {}
): Promise<{ scanned: number; markedObsolete: number }> {
  const rows = await runSqliteJson<EntityTagRow>(
    dbPath,
    `SELECT * FROM entity_tags WHERE status='active';`
  );
  if (rows.length === 0) return { scanned: 0, markedObsolete: 0 };

  const now = nowMs();
  const halfLifeDays = settings.halfLifeDays ?? DEFAULT_HALF_LIFE_DAYS;
  const pruneThreshold = settings.pruneThreshold ?? DEFAULT_PRUNE_THRESHOLD;
  const hitBoost = settings.hitBoost ?? DEFAULT_HIT_BOOST;
  const consensusFactor = settings.consensusFactor ?? DEFAULT_CONSENSUS_FACTOR;
  const affected = new Set<string>();
  const statements: string[] = [];
  let markedObsolete = 0;

  for (const row of rows) {
    const weight = computeDecayedWeight({
      baseWeight: row.source === "manual" ? 2.0 : 1.0,
      consensusCount: row.consensus_count || 1,
      hitCount: row.hit_count || 0,
      hitBoost,
      consensusFactor,
      lastDecayAtMs: row.last_decay_at_ms || row.created_at_ms,
      nowMs: now,
      halfLifeDays,
      source: row.source as TagSource
    });
    const status = determineTagStatus({
      weight,
      pruneThreshold,
      lastHitAtMs: row.last_hit_at_ms || row.created_at_ms,
      nowMs: now,
      source: row.source as TagSource
    });
    if (status === "obsolete") markedObsolete += 1;
    statements.push(
      `UPDATE entity_tags SET
         weight=${weight},
         status='${status}',
         updated_at_ms=${now},
         last_decay_at_ms=${now},
         obsolete_at_ms=${status === "obsolete" ? (row.obsolete_at_ms ?? now) : "NULL"}
       WHERE id='${escapeSqlLiteral(row.id)}';`
    );
    affected.add(row.normalized_tag);
  }

  if (statements.length > 0) {
    // Batch in chunks to avoid huge transactions
    const CHUNK = 80;
    for (let i = 0; i < statements.length; i += CHUNK) {
      await runSqliteTransaction(dbPath, statements.slice(i, i + CHUNK));
    }
  }
  for (const tag of affected) {
    await refreshConsensusForTag(dbPath, tag, settings);
  }
  return { scanned: rows.length, markedObsolete };
}

export interface ListEntityTagsOptions {
  includeObsolete?: boolean;
}

export async function listEntityTags(
  dbPath: string,
  entityType: TagEntityType,
  entityId: string,
  options: ListEntityTagsOptions = {}
): Promise<EntityTagSummary[]> {
  const statusFilter = options.includeObsolete ? "" : " AND status='active'";
  const rows = await runSqliteJson<EntityTagRow>(
    dbPath,
    `SELECT * FROM entity_tags
     WHERE entity_type='${escapeSqlLiteral(entityType)}'
       AND entity_id='${escapeSqlLiteral(entityId)}'
       ${statusFilter}
     ORDER BY weight DESC, updated_at_ms DESC;`
  );
  return rows.map((r) => ({
    tag: r.tag,
    normalizedTag: r.normalized_tag,
    category: r.category as TagCategory,
    weight: r.weight,
    hitCount: r.hit_count,
    consensusCount: r.consensus_count,
    status: r.status as TagStatus,
    source: r.source as TagSource
  }));
}

export async function listTagDefinitions(
  dbPath: string,
  filter: TagFilterOptions = {}
): Promise<TagDefinitionRow[]> {
  const where: string[] = [];
  if (filter.category) {
    where.push(`category='${escapeSqlLiteral(filter.category)}'`);
  }
  if (filter.status && filter.status !== "all") {
    where.push(`status='${escapeSqlLiteral(filter.status)}'`);
  } else if (!filter.status) {
    where.push(`status='active'`);
  }
  if (filter.minWeight !== undefined) {
    where.push(`global_weight>=${Number(filter.minWeight)}`);
  }
  if (filter.query?.trim()) {
    const q = escapeSqlLiteral(filter.query.trim().toLowerCase());
    where.push(
      `(LOWER(normalized_tag) LIKE '%${q}%' OR LOWER(display_name) LIKE '%${q}%')`
    );
  }
  if (filter.entityType === "session") {
    where.push(`session_count>0`);
  } else if (filter.entityType === "note") {
    where.push(`note_count>0`);
  }

  let orderBy = "global_weight DESC, active_entity_count DESC";
  switch (filter.sortBy) {
    case "count":
      orderBy = "active_entity_count DESC, global_weight DESC";
      break;
    case "recency":
      orderBy = "updated_at_ms DESC";
      break;
    case "alpha":
      orderBy = "display_name COLLATE NOCASE ASC";
      break;
    case "weight":
    default:
      orderBy = "global_weight DESC, active_entity_count DESC";
  }

  const limit = Math.max(1, Math.min(500, filter.limit ?? 100));
  const offset = Math.max(0, filter.offset ?? 0);
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  return runSqliteJson<TagDefinitionRow>(
    dbPath,
    `SELECT * FROM tag_definitions
     ${whereSql}
     ORDER BY ${orderBy}
     LIMIT ${limit} OFFSET ${offset};`
  );
}

export async function searchTagDefinitions(
  dbPath: string,
  query: string,
  options: Omit<TagFilterOptions, "query"> = {}
): Promise<TagDefinitionRow[]> {
  return listTagDefinitions(dbPath, { ...options, query, sortBy: options.sortBy ?? "weight" });
}

/**
 * List entities that carry a given tag.
 */
export async function listEntitiesByTag(
  dbPath: string,
  tag: string,
  options: {
    entityType?: TagEntityType | "all";
    includeObsolete?: boolean;
    limit?: number;
  } = {}
): Promise<TagEntityHitItem[]> {
  const normalized = normalizeTagName(tag);
  if (!normalized) return [];
  const where: string[] = [`normalized_tag='${escapeSqlLiteral(normalized)}'`];
  if (options.entityType && options.entityType !== "all") {
    where.push(`entity_type='${escapeSqlLiteral(options.entityType)}'`);
  }
  if (!options.includeObsolete) {
    where.push(`status='active'`);
  }
  const limit = Math.max(1, Math.min(500, options.limit ?? 100));

  const rows = await runSqliteJson<EntityTagRow>(
    dbPath,
    `SELECT * FROM entity_tags
     WHERE ${where.join(" AND ")}
     ORDER BY weight DESC, updated_at_ms DESC
     LIMIT ${limit};`
  );

  return rows.map((r) => ({
    entityType: r.entity_type as TagEntityType,
    entityId: r.entity_id,
    weight: r.weight,
    hitCount: r.hit_count,
    status: r.status as TagStatus,
    updatedAtMs: r.updated_at_ms
  }));
}

/**
 * Best-effort hit tracking for search/RAG recall results.
 * Caps work to the top N entities and never throws to callers.
 */
export async function recordSearchResultTagHits(
  dbPath: string,
  entities: Array<{ entityType: TagEntityType; entityId: string }>,
  settings: TagStoreSettings = {},
  maxEntities = 8
): Promise<void> {
  const seen = new Set<string>();
  let count = 0;
  for (const entity of entities) {
    if (!entity?.entityType || !entity?.entityId) continue;
    const key = `${entity.entityType}:${entity.entityId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      await recordEntityTagHits(dbPath, entity.entityType, entity.entityId, settings);
    } catch {
      // non-fatal
    }
    count += 1;
    if (count >= maxEntities) break;
  }
}

/** Build the canonical entity id for a session: `${provider}:${agentSessionId}`. */
export function sessionEntityId(provider: string, agentSessionId: string): string {
  return `${provider}:${agentSessionId}`;
}

/** Parse a session entity id back into provider + sessionId. */
export function parseSessionEntityId(
  entityId: string
): { provider: string; agentSessionId: string } | undefined {
  const idx = entityId.indexOf(":");
  if (idx <= 0) return undefined;
  return {
    provider: entityId.slice(0, idx),
    agentSessionId: entityId.slice(idx + 1)
  };
}

/** Convenience: generate a fresh row id (used by tests / migrations). */
export function newEntityTagRowId(): string {
  return randomUUID();
}