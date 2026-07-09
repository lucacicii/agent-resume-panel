import { ensureCatalogSchema } from "../catalog/db";
import { embedTexts } from "../llm/embeddings";
import { embeddingConfigFromSettings } from "../llm/fromSettings";
import { catalogDbPath, resolvePanelHome } from "../panelHome";
import { catalogDbFromSettings, effectivePanelHome, loadSettings } from "../settings/store";
import { cosineSimilarity, parseEmbeddingJson } from "./cosine";
import { MemoryEntry, MemoryLevel } from "./schema";
import { listMemoryEntries } from "./store";

export interface SearchMemoryOptions {
  panelHome?: string;
  query: string;
  level?: MemoryLevel | string;
  limit?: number;
  /** Minimum cosine similarity (default 0.15). */
  minScore?: number;
  /** Max candidates scanned from DB (default 200). */
  candidateLimit?: number;
}

export interface MemorySearchHit {
  entry: MemoryEntry;
  score: number;
}

export async function searchMemoryByEmbedding(
  options: SearchMemoryOptions
): Promise<MemorySearchHit[]> {
  const query = options.query?.trim();
  if (!query) {
    throw new Error("Search query is empty.");
  }

  const settings = await loadSettings(options.panelHome);
  const panelHome = options.panelHome
    ? resolvePanelHome(options.panelHome)
    : effectivePanelHome(settings, options.panelHome);
  const dbPath = options.panelHome
    ? catalogDbPath(panelHome)
    : catalogDbFromSettings(settings, options.panelHome);

  await ensureCatalogSchema(dbPath);

  const emb = embeddingConfigFromSettings(settings);
  if (!emb) {
    throw new Error(
      "Embedding is not configured. Set embedding.model (and llm/embedding API key) in settings.json."
    );
  }

  const [queryVector] = await embedTexts(emb, [query.slice(0, 8000)]);
  const candidates = await listMemoryEntries(dbPath, {
    level: options.level,
    limit: options.candidateLimit ?? 200
  });

  const minScore = options.minScore ?? 0.15;
  const limit = Math.max(1, Math.min(options.limit ?? 20, 100));
  const hits: MemorySearchHit[] = [];

  for (const entry of candidates) {
    const vec = parseEmbeddingJson(entry.embeddingJson);
    if (!vec) {
      continue;
    }
    const score = cosineSimilarity(queryVector, vec);
    if (score == null || score < minScore) {
      continue;
    }
    hits.push({ entry, score });
  }

  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, limit);
}
