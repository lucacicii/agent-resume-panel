import { chatCompletionDetailed } from "../llm/chat";
import { LlmRuntimeConfig } from "../llm/types";
import { TokenUsage } from "../usage/types";
import {
  ExtractedTag,
  TagCategory,
  TagExtractionResult,
  TAG_CATEGORIES
} from "./types";
import { normalizeCategory, normalizeTagName } from "./decay";
import { buildNoteTagUserPrompt, buildSessionTagUserPrompt, buildTagSystemPrompt } from "./prompts";

interface RawTagJson {
  tag?: string;
  category?: string;
  confidence?: number;
}

function parseJsonContent(content: string): RawTagJson[] {
  const trimmed = content.trim();
  const jsonStart = trimmed.indexOf("{");
  const jsonEnd = trimmed.lastIndexOf("}");
  let obj: unknown;
  if (jsonStart >= 0 && jsonEnd > jsonStart) {
    try {
      obj = JSON.parse(trimmed.slice(jsonStart, jsonEnd + 1));
    } catch {
      return [];
    }
  } else {
    return [];
  }
  const rawTags = (obj as { tags?: unknown })?.tags;
  if (!Array.isArray(rawTags)) {
    return [];
  }
  return rawTags.filter((t): t is RawTagJson => typeof t === "object" && t !== null);
}

function dedupeAndRank(raw: RawTagJson[], maxTags: number): ExtractedTag[] {
  const seen = new Set<string>();
  const ranked: Array<{ tag: string; category: TagCategory; confidence: number }> = [];
  for (const item of raw) {
    const tag = normalizeTagName(item.tag || "");
    if (!tag) continue;
    const category = normalizeCategory(item.category);
    const confidence = Number.isFinite(item.confidence)
      ? Math.max(0, Math.min(1, Number(item.confidence)))
      : 0.6;
    if (seen.has(tag)) continue;
    seen.add(tag);
    ranked.push({ tag, category, confidence });
  }
  ranked.sort((a, b) => b.confidence - a.confidence);
  return ranked.slice(0, maxTags);
}

export interface ExtractSessionTagsInput {
  title?: string;
  summary?: string;
  transcriptExcerpt: string;
  maxChars?: number;
}

export interface ExtractNoteTagsInput {
  title: string;
  body: string;
  maxChars?: number;
}

/**
 * Ask the tool LLM to extract up to `maxTags` tags across the 7 broad dimensions.
 */
export async function extractTagsFromSession(
  config: LlmRuntimeConfig,
  input: ExtractSessionTagsInput,
  maxTags = 6
): Promise<TagExtractionResult> {
  const maxChars = input.maxChars ?? config.maxContextChars ?? 120_000;
  const userContent = buildSessionTagUserPrompt(
    input.title,
    input.summary,
    input.transcriptExcerpt,
    maxChars
  );
  const result = await chatCompletionDetailed(
    config,
    [
      { role: "system", content: buildTagSystemPrompt(config.outputLanguage || "en") },
      { role: "user", content: userContent }
    ],
    1200
  );
  const raw = parseJsonContent(result.content);
  return {
    tags: dedupeAndRank(raw, Math.max(1, Math.min(10, maxTags))),
    usage: result.usage
      ? {
          promptTokens: result.usage.promptTokens,
          completionTokens: result.usage.completionTokens,
          totalTokens: result.usage.totalTokens
        }
      : undefined
  };
}

export async function extractTagsFromNote(
  config: LlmRuntimeConfig,
  input: ExtractNoteTagsInput,
  maxTags = 6
): Promise<TagExtractionResult> {
  const maxChars = input.maxChars ?? config.maxContextChars ?? 120_000;
  const userContent = buildNoteTagUserPrompt(input.title, input.body, maxChars);
  const result = await chatCompletionDetailed(
    config,
    [
      { role: "system", content: buildTagSystemPrompt(config.outputLanguage || "en") },
      { role: "user", content: userContent }
    ],
    1200
  );
  const raw = parseJsonContent(result.content);
  return {
    tags: dedupeAndRank(raw, Math.max(1, Math.min(10, maxTags))),
    usage: result.usage
      ? {
          promptTokens: result.usage.promptTokens,
          completionTokens: result.usage.completionTokens,
          totalTokens: result.usage.totalTokens
        }
      : undefined
  };
}

/** Validate that a category is one of the 7 known dimensions (for external callers). */
export function isKnownTagCategory(cat?: string): cat is TagCategory {
  return !!cat && (TAG_CATEGORIES as readonly string[]).includes(cat);
}