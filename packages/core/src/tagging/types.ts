export type TagCategory =
  | "tech_stack"
  | "business_domain"
  | "architecture"
  | "task_type"
  | "problem_domain"
  | "concept_knowledge"
  | "context_env";

export const TAG_CATEGORIES: readonly TagCategory[] = [
  "tech_stack",
  "business_domain",
  "architecture",
  "task_type",
  "problem_domain",
  "concept_knowledge",
  "context_env"
] as const;

export type TagStatus = "active" | "obsolete";
export type TagSource = "auto" | "manual";
export type TagEntityType = "session" | "note";

export interface EntityTagRow {
  id: string;
  entity_type: TagEntityType;
  entity_id: string;
  tag: string;
  normalized_tag: string;
  category: TagCategory;
  weight: number;
  hit_count: number;
  consensus_count: number;
  status: TagStatus;
  source: TagSource;
  created_at_ms: number;
  updated_at_ms: number;
  last_hit_at_ms: number;
  last_decay_at_ms: number;
  obsolete_at_ms?: number | null;
}

export interface TagDefinitionRow {
  normalized_tag: string;
  display_name: string;
  category: TagCategory;
  session_count: number;
  note_count: number;
  active_entity_count: number;
  total_hits: number;
  global_weight: number;
  status: TagStatus;
  pinned: number;
  created_at_ms: number;
  updated_at_ms: number;
}

export interface ExtractedTag {
  tag: string;
  category: TagCategory;
  confidence?: number;
}

export interface TagExtractionResult {
  tags: ExtractedTag[];
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
}

export interface TagFilterOptions {
  category?: TagCategory;
  status?: TagStatus | "all";
  entityType?: TagEntityType | "all";
  minWeight?: number;
  query?: string;
  limit?: number;
  offset?: number;
  sortBy?: "weight" | "count" | "recency" | "alpha";
}

export interface EntityTagSummary {
  tag: string;
  normalizedTag: string;
  category: TagCategory;
  weight: number;
  hitCount: number;
  consensusCount: number;
  status: TagStatus;
  source: TagSource;
  pinned?: boolean;
}

export interface TagEntityHitItem {
  entityType: TagEntityType;
  entityId: string;
  title?: string;
  projectPath?: string;
  provider?: string;
  weight: number;
  hitCount: number;
  status: TagStatus;
  updatedAtMs: number;
}
