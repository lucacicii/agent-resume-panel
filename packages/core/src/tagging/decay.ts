import type { TagCategory, TagSource, TagStatus } from "./types";
import { TAG_CATEGORIES } from "./types";

export const DEFAULT_HALF_LIFE_DAYS = 7;
export const DEFAULT_PRUNE_THRESHOLD = 0.1;
export const DEFAULT_HIT_BOOST = 0.5;
export const DEFAULT_CONSENSUS_FACTOR = 0.5;
export const DEFAULT_GRACE_PERIOD_DAYS = 14;

/**
 * Clean and normalize a raw tag string for deduplication and indexing.
 * E.g., "  #React.js!  " -> "react.js"
 */
export function normalizeTagName(rawTag: string): string {
  if (!rawTag) return "";
  return rawTag
    .trim()
    .toLowerCase()
    .replace(/^#+/, "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s,;:._-]+|[\s,;:._-]+$/g, "")
    .slice(0, 80);
}

/**
 * Validate and normalize a tag category.
 */
export function normalizeCategory(cat?: string | null): TagCategory {
  const c = cat?.toLowerCase().trim() as TagCategory;
  if (c && TAG_CATEGORIES.includes(c)) {
    return c;
  }
  return "tech_stack";
}

/**
 * Calculate multi-entity co-occurrence / consensus boost:
 * Delta = min(2.5, factor * log2(consensusCount))
 */
export function computeConsensusBoost(
  consensusCount: number,
  factor = DEFAULT_CONSENSUS_FACTOR
): number {
  if (consensusCount <= 1) return 0;
  const boost = factor * Math.log2(consensusCount);
  return Math.min(2.5, Math.max(0, boost));
}

export interface DecayedWeightParams {
  baseWeight?: number;
  consensusCount?: number;
  hitCount?: number;
  hitBoost?: number;
  consensusFactor?: number;
  lastDecayAtMs: number;
  nowMs?: number;
  halfLifeDays?: number;
  source?: TagSource;
}

/**
 * Calculate the time-decayed weight of an entity tag.
 */
export function computeDecayedWeight(params: DecayedWeightParams): number {
  const {
    baseWeight = 1.0,
    consensusCount = 1,
    hitCount = 0,
    hitBoost = DEFAULT_HIT_BOOST,
    consensusFactor = DEFAULT_CONSENSUS_FACTOR,
    lastDecayAtMs,
    nowMs = Date.now(),
    halfLifeDays = DEFAULT_HALF_LIFE_DAYS,
    source = "auto"
  } = params;

  const consensusBoost = computeConsensusBoost(consensusCount, consensusFactor);
  const rawBase = Math.max(0.1, baseWeight) + consensusBoost + Math.max(0, hitCount) * hitBoost;

  // Manual tags do not decay by default
  if (source === "manual") {
    return Math.round(rawBase * 1000) / 1000;
  }

  const elapsedMs = Math.max(0, nowMs - lastDecayAtMs);
  const elapsedDays = elapsedMs / (86_400_000);

  // Extend half-life for high-consensus tags to protect cross-project anchors
  const effectiveHalfLife = halfLifeDays * (1 + 0.2 * Math.min(5, Math.max(0, consensusCount - 1)));

  const decayed = rawBase * Math.pow(0.5, elapsedDays / effectiveHalfLife);
  return Math.max(0, Math.round(decayed * 1000) / 1000);
}

export interface TagStatusParams {
  weight: number;
  pruneThreshold?: number;
  lastHitAtMs: number;
  nowMs?: number;
  source?: TagSource;
  pinned?: boolean;
  gracePeriodDays?: number;
}

/**
 * Determine whether a tag should remain active or be marked obsolete (soft-decayed).
 */
export function determineTagStatus(params: TagStatusParams): TagStatus {
  const {
    weight,
    pruneThreshold = DEFAULT_PRUNE_THRESHOLD,
    lastHitAtMs,
    nowMs = Date.now(),
    source = "auto",
    pinned = false,
    gracePeriodDays = DEFAULT_GRACE_PERIOD_DAYS
  } = params;

  if (pinned || source === "manual") {
    return "active";
  }

  const elapsedMs = Math.max(0, nowMs - lastHitAtMs);
  const elapsedDays = elapsedMs / (86_400_000);

  if (weight < pruneThreshold && elapsedDays >= gracePeriodDays) {
    return "obsolete";
  }

  return "active";
}
