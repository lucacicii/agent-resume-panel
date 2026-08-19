import { z } from "zod";
import { TAG_CATEGORIES, type TagCategory, type TagEntityType, type TagStatus } from "../tagging/types";
import {
  addManualTag,
  listEntitiesByTag,
  listEntityTags,
  listTagDefinitions,
  parseSessionEntityId,
  removeEntityTag,
  searchTagDefinitions,
  sessionEntityId
} from "../tagging/store";
import { normalizeCategory, normalizeTagName } from "../tagging/decay";

export interface TagToolContext {
  /** Desktop DB that holds entity_tags / tag_definitions. */
  dbPath: string;
}

export const TAG_LIST_DEFAULT_LIMIT = 50;
export const TAG_LIST_MAX_LIMIT = 200;
export const TAG_ENTITIES_DEFAULT_LIMIT = 50;
export const TAG_ENTITIES_MAX_LIMIT = 200;

function clampLimit(limit: number | undefined, fallback: number, max: number): number {
  const raw = Number(limit);
  if (!Number.isFinite(raw) || raw < 1) return fallback;
  return Math.min(Math.floor(raw), max);
}

function tagResponse(message: string, data: Record<string, unknown> = {}): {
  content: Array<{ type: "text"; text: string }>;
} {
  const payload = { ok: true, message, ...data };
  return {
    content: [{ type: "text", text: `${message}\n${JSON.stringify(payload, null, 2)}` }]
  };
}

function tagError(message: string): {
  content: Array<{ type: "text"; text: string }>;
  isError: true;
} {
  return {
    isError: true,
    content: [{ type: "text", text: message }]
  };
}

const categoryEnum = z.enum(TAG_CATEGORIES as unknown as [TagCategory, ...TagCategory[]]);
const statusEnum = z.enum(["active", "obsolete", "all"]);
const entityTypeEnum = z.enum(["session", "note", "all"]);
const sortByEnum = z.enum(["weight", "count", "recency", "alpha"]);

export const tagListSchema = {
  category: categoryEnum
    .optional()
    .describe(
      "Filter by dimension: tech_stack, business_domain, architecture, task_type, problem_domain, concept_knowledge, context_env."
    ),
  status: statusEnum
    .optional()
    .describe("Filter by lifecycle status. Defaults to active."),
  entityType: entityTypeEnum
    .optional()
    .describe("Only tags that currently have session / note entities."),
  minWeight: z
    .number()
    .min(0)
    .optional()
    .describe("Minimum global_weight."),
  query: z.string().optional().describe("Substring filter on tag name."),
  sortBy: sortByEnum.optional().describe("Sort order. Defaults to weight."),
  limit: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe(`Maximum tags. Defaults to ${TAG_LIST_DEFAULT_LIMIT}, capped at ${TAG_LIST_MAX_LIMIT}.`),
  offset: z.number().int().min(0).optional().describe("Pagination offset.")
};

export const tagSearchSchema = {
  query: z.string().min(1).describe("Keyword to match against tag names."),
  category: categoryEnum.optional().describe("Optional dimension filter."),
  status: statusEnum.optional().describe("Lifecycle filter. Defaults to active."),
  limit: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe(`Maximum tags. Defaults to ${TAG_LIST_DEFAULT_LIMIT}, capped at ${TAG_LIST_MAX_LIMIT}.`)
};

export const tagEntitiesListSchema = {
  tag: z.string().min(1).describe("Tag name (display or normalized)."),
  entityType: entityTypeEnum
    .optional()
    .describe("Filter to session / note / all. Defaults to all."),
  includeObsolete: z
    .boolean()
    .optional()
    .describe("Include soft-obsolete entity bindings. Default false."),
  limit: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe(
      `Maximum entities. Defaults to ${TAG_ENTITIES_DEFAULT_LIMIT}, capped at ${TAG_ENTITIES_MAX_LIMIT}.`
    )
};

export const entityTagsGetSchema = {
  entityType: z.enum(["session", "note"]).describe("Entity kind."),
  provider: z
    .string()
    .optional()
    .describe("Required when entityType=session: agent provider."),
  sessionId: z
    .string()
    .optional()
    .describe("Required when entityType=session: native agent session id."),
  noteId: z.string().optional().describe("Required when entityType=note."),
  entityId: z
    .string()
    .optional()
    .describe("Optional full entity id (session: provider:sessionId, note: noteId). Overrides parts."),
  includeObsolete: z
    .boolean()
    .optional()
    .describe("Include obsolete tags. Default false.")
};

export const entityTagAddSchema = {
  entityType: z.enum(["session", "note"]).describe("Entity kind."),
  entityId: z
    .string()
    .optional()
    .describe("Full entity id. For sessions prefer provider+sessionId."),
  provider: z.string().optional().describe("Session provider when entityType=session."),
  sessionId: z.string().optional().describe("Session id when entityType=session."),
  noteId: z.string().optional().describe("Note id when entityType=note."),
  tag: z.string().min(1).describe("Tag display name to add."),
  category: categoryEnum
    .optional()
    .describe("Optional dimension. Defaults to tech_stack when unknown.")
};

export const entityTagRemoveSchema = {
  entityType: z.enum(["session", "note"]).describe("Entity kind."),
  entityId: z.string().optional().describe("Full entity id."),
  provider: z.string().optional().describe("Session provider when entityType=session."),
  sessionId: z.string().optional().describe("Session id when entityType=session."),
  noteId: z.string().optional().describe("Note id when entityType=note."),
  tag: z.string().min(1).describe("Tag to remove."),
  hardDelete: z
    .boolean()
    .optional()
    .describe("Physically delete the binding instead of soft-obsoleting. Default false.")
};

function resolveEntityId(args: {
  entityType: "session" | "note";
  entityId?: string;
  provider?: string;
  sessionId?: string;
  noteId?: string;
}): { entityType: TagEntityType; entityId: string } {
  if (args.entityId?.trim()) {
    return { entityType: args.entityType, entityId: args.entityId.trim() };
  }
  if (args.entityType === "session") {
    const provider = args.provider?.trim();
    const sessionId = args.sessionId?.trim();
    if (!provider || !sessionId) {
      throw new Error("entityType=session requires provider+sessionId or entityId.");
    }
    return { entityType: "session", entityId: sessionEntityId(provider, sessionId) };
  }
  const noteId = args.noteId?.trim();
  if (!noteId) {
    throw new Error("entityType=note requires noteId or entityId.");
  }
  return { entityType: "note", entityId: noteId };
}

export async function handleTagList(
  args: {
    category?: TagCategory;
    status?: TagStatus | "all";
    entityType?: TagEntityType | "all";
    minWeight?: number;
    query?: string;
    sortBy?: "weight" | "count" | "recency" | "alpha";
    limit?: number;
    offset?: number;
  },
  ctx: TagToolContext
) {
  const limit = clampLimit(args.limit, TAG_LIST_DEFAULT_LIMIT, TAG_LIST_MAX_LIMIT);
  const rows = await listTagDefinitions(ctx.dbPath, {
    category: args.category,
    status: args.status,
    entityType: args.entityType,
    minWeight: args.minWeight,
    query: args.query,
    sortBy: args.sortBy,
    limit,
    offset: args.offset
  });
  const tags = rows.map((r) => ({
    tag: r.display_name,
    normalizedTag: r.normalized_tag,
    category: r.category,
    sessionCount: r.session_count,
    noteCount: r.note_count,
    activeEntityCount: r.active_entity_count,
    totalHits: r.total_hits,
    globalWeight: r.global_weight,
    status: r.status,
    pinned: !!r.pinned,
    updatedAtMs: r.updated_at_ms
  }));
  return tagResponse(`Listed ${tags.length} tag(s).`, { tags, count: tags.length });
}

export async function handleTagSearch(
  args: {
    query: string;
    category?: TagCategory;
    status?: TagStatus | "all";
    limit?: number;
  },
  ctx: TagToolContext
) {
  const query = args.query?.trim();
  if (!query) return tagError("query is required.");
  const limit = clampLimit(args.limit, TAG_LIST_DEFAULT_LIMIT, TAG_LIST_MAX_LIMIT);
  const rows = await searchTagDefinitions(ctx.dbPath, query, {
    category: args.category,
    status: args.status ?? "active",
    limit
  });
  const tags = rows.map((r) => ({
    tag: r.display_name,
    normalizedTag: r.normalized_tag,
    category: r.category,
    activeEntityCount: r.active_entity_count,
    globalWeight: r.global_weight,
    status: r.status
  }));
  if (!tags.length) {
    return tagResponse(`No tags matching "${query}".`, { tags: [], count: 0, query });
  }
  return tagResponse(`Found ${tags.length} tag(s) matching "${query}".`, {
    tags,
    count: tags.length,
    query
  });
}

export async function handleTagEntitiesList(
  args: {
    tag: string;
    entityType?: TagEntityType | "all";
    includeObsolete?: boolean;
    limit?: number;
  },
  ctx: TagToolContext
) {
  const tag = args.tag?.trim();
  if (!tag) return tagError("tag is required.");
  const limit = clampLimit(args.limit, TAG_ENTITIES_DEFAULT_LIMIT, TAG_ENTITIES_MAX_LIMIT);
  const entities = await listEntitiesByTag(ctx.dbPath, tag, {
    entityType: args.entityType,
    includeObsolete: args.includeObsolete === true,
    limit
  });
  const enriched = entities.map((e) => {
    if (e.entityType === "session") {
      const parsed = parseSessionEntityId(e.entityId);
      return {
        ...e,
        provider: parsed?.provider,
        sessionId: parsed?.agentSessionId
      };
    }
    return { ...e, noteId: e.entityId };
  });
  return tagResponse(
    `Found ${enriched.length} entit${enriched.length === 1 ? "y" : "ies"} for tag "${tag}".`,
    {
      tag: normalizeTagName(tag),
      entities: enriched,
      count: enriched.length
    }
  );
}

export async function handleEntityTagsGet(
  args: {
    entityType: "session" | "note";
    provider?: string;
    sessionId?: string;
    noteId?: string;
    entityId?: string;
    includeObsolete?: boolean;
  },
  ctx: TagToolContext
) {
  try {
    const { entityType, entityId } = resolveEntityId(args);
    const tags = await listEntityTags(ctx.dbPath, entityType, entityId, {
      includeObsolete: args.includeObsolete === true
    });
    return tagResponse(`Entity has ${tags.length} tag(s).`, {
      entityType,
      entityId,
      tags,
      count: tags.length
    });
  } catch (error) {
    return tagError(error instanceof Error ? error.message : String(error));
  }
}

export async function handleEntityTagAdd(
  args: {
    entityType: "session" | "note";
    entityId?: string;
    provider?: string;
    sessionId?: string;
    noteId?: string;
    tag: string;
    category?: TagCategory;
  },
  ctx: TagToolContext
) {
  try {
    const { entityType, entityId } = resolveEntityId(args);
    const tag = args.tag?.trim();
    if (!tag) return tagError("tag is required.");
    const result = await addManualTag(
      ctx.dbPath,
      entityType,
      entityId,
      tag,
      args.category ? normalizeCategory(args.category) : undefined
    );
    if (!result) return tagError("Failed to add tag (empty name after normalize).");
    return tagResponse(`Added tag "${result.tag}" to ${entityType} ${entityId}.`, {
      entityType,
      entityId,
      tag: result
    });
  } catch (error) {
    return tagError(error instanceof Error ? error.message : String(error));
  }
}

export async function handleEntityTagRemove(
  args: {
    entityType: "session" | "note";
    entityId?: string;
    provider?: string;
    sessionId?: string;
    noteId?: string;
    tag: string;
    hardDelete?: boolean;
  },
  ctx: TagToolContext
) {
  try {
    const { entityType, entityId } = resolveEntityId(args);
    const tag = args.tag?.trim();
    if (!tag) return tagError("tag is required.");
    const ok = await removeEntityTag(
      ctx.dbPath,
      entityType,
      entityId,
      tag,
      args.hardDelete === true
    );
    if (!ok) {
      return tagResponse(`Tag "${tag}" not found on ${entityType} ${entityId}.`, {
        entityType,
        entityId,
        removed: false
      });
    }
    return tagResponse(
      args.hardDelete
        ? `Hard-deleted tag "${tag}" from ${entityType} ${entityId}.`
        : `Marked tag "${tag}" obsolete on ${entityType} ${entityId}.`,
      { entityType, entityId, tag, removed: true, hardDelete: args.hardDelete === true }
    );
  } catch (error) {
    return tagError(error instanceof Error ? error.message : String(error));
  }
}