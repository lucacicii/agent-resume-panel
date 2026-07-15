import { embedTextsDetailed } from "../llm/embeddings";
import { embeddingConfigFromSettings } from "../llm/fromSettings";
import { PanelSettings } from "../settings/types";
import { TokenUsage } from "../usage/types";
import { ReportEntry } from "./schema";
import { insertReportEntry, upsertReportJob } from "./store";

export async function maybeEmbedContent(
  settings: PanelSettings,
  content: string,
  skipEmbedding?: boolean
): Promise<{
  embeddingJson: string | null;
  embedded: boolean;
  usage?: TokenUsage;
  model?: string;
  durationMs?: number;
}> {
  if (skipEmbedding) {
    return { embeddingJson: null, embedded: false };
  }

  const emb = embeddingConfigFromSettings(settings);
  if (!emb) {
    return { embeddingJson: null, embedded: false };
  }

  try {
    const result = await embedTextsDetailed(emb, [content.slice(0, 8000)]);
    const vector = result.vectors[0];
    if (!vector) {
      return { embeddingJson: null, embedded: false };
    }
    return {
      embeddingJson: JSON.stringify(vector),
      embedded: true,
      usage: result.usage,
      model: result.model,
      durationMs: result.durationMs
    };
  } catch {
    return { embeddingJson: null, embedded: false };
  }
}

export async function finalizeDigestEntry(
  dbPath: string,
  entry: ReportEntry,
  links: Array<{ provider: string; agentSessionId: string; projectPath: string }>,
  jobKey: string
): Promise<{ replaced: boolean }> {
  const { replaced } = await insertReportEntry(dbPath, entry, links);
  await upsertReportJob(dbPath, jobKey, "ok");
  return { replaced };
}
