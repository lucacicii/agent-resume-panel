import type { ModelKind } from "./types";

/**
 * Primary capability kind for a model id. Heuristic only — users can override
 * the kind in settings for any fetched/manual model.
 *
 * - embedding: text-embedding-*, embed-*, *embedding*, oai-embedding / ada
 * - image: image generation / vision-first names (dall-e, gpt-image, flux,
 *   sora, stable-diffusion, imagen, ...)
 * - text: everything else (includes multimodal chat models like gpt-4o)
 */
export function classifyModelKind(modelId: string): ModelKind {
  const id = String(modelId || "").trim().toLowerCase();
  if (!id) return "text";

  if (
    /(^|[^a-z])embed[^a-z]/.test(id) ||
    /embedding/.test(id) ||
    /(^|[^a-z])ada$/.test(id) ||
    id === "oai-embedding"
  ) {
    return "embedding";
  }

  if (
    /image/.test(id) ||
    /dall/.test(id) ||
    /dalle/.test(id) ||
    /sora/.test(id) ||
    /flux/.test(id) ||
    /stable-diffusion/.test(id) ||
    /imagen/.test(id) ||
    /midjourney/.test(id)
  ) {
    return "image";
  }

  return "text";
}