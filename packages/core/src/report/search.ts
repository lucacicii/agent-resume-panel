import { embedTexts } from "../llm/embeddings";
import { embeddingConfigFromSettings } from "../llm/fromSettings";
import { preparePanelDatabasesFromSettings } from "../dbPaths";
import { loadSettings } from "../settings/store";
import { cosineSimilarity, parseEmbeddingJson } from "./cosine";
import { ReportEntry, ReportLevel } from "./schema";
import { listReportEntries } from "./store";

export interface SearchReportsOptions {
  panelHome?: string;
  query: string;
  level?: ReportLevel | string;
  limit?: number;
  /** Minimum cosine similarity (default 0.15). */
  minScore?: number;
  /** Max candidates scanned from DB (default 200). */
  candidateLimit?: number;
  /** Reuse a query embedding already computed by a combined retrieval pipeline. */
  queryVector?: number[];
}

export interface ReportSearchHit {
  entry: ReportEntry;
  score: number;
}

export async function searchReportsByEmbedding(
  options: SearchReportsOptions
): Promise<ReportSearchHit[]> {
  const query = options.query?.trim();
  if (!query) {
    throw new Error("Search query is empty.");
  }

  const settings = await loadSettings(options.panelHome);
  const paths = await preparePanelDatabasesFromSettings(options.panelHome);
  const desktopDb = paths.desktopDb;

  let queryVector = options.queryVector;
  if (!queryVector) {
    const emb = embeddingConfigFromSettings(settings);
    if (!emb) {
      throw new Error(
        "Embedding is not configured. Set embedding.model (and llm/embedding API key) in settings.json."
      );
    }
    [queryVector] = await embedTexts(emb, [query.slice(0, 8000)]);
  }
  if (!queryVector) {
    return [];
  }
  const candidates = await listReportEntries(desktopDb, {
    level: options.level,
    limit: options.candidateLimit ?? 200
  });

  const minScore = options.minScore ?? 0.15;
  const limit = Math.max(1, Math.min(options.limit ?? 20, 100));
  const hits: ReportSearchHit[] = [];

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