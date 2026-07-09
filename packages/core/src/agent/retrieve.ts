import { AgentProvider } from "../catalog/types";
import { ensureCatalogSchema } from "../catalog/db";
import { catalogDbPath, resolvePanelHome } from "../panelHome";
import { catalogDbFromSettings, effectivePanelHome, loadSettings } from "../settings/store";
import { MemoryEntry } from "../memory/schema";
import { listMemoryEntries, listMemoryLinks } from "../memory/store";
import { searchMemoryByEmbedding } from "../memory/search";
import { AgentCitation } from "./types";

const DEFAULT_LIMIT = 8;
const CONTENT_CHARS = 2000;

export interface RetrievedDigest {
  entry: MemoryEntry;
  score?: number;
}

export interface RetrieveAgentContextResult {
  digests: RetrievedDigest[];
  citations: AgentCitation[];
  fallback: boolean;
  dbPath: string;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max)}\n[...truncated...]`;
}

export async function retrieveAgentContext(options: {
  query: string;
  panelHome?: string;
  limit?: number;
}): Promise<RetrieveAgentContextResult> {
  const settings = await loadSettings(options.panelHome);
  const panelHome = options.panelHome
    ? resolvePanelHome(options.panelHome)
    : effectivePanelHome(settings, options.panelHome);
  const dbPath = options.panelHome
    ? catalogDbPath(panelHome)
    : catalogDbFromSettings(settings, options.panelHome);

  await ensureCatalogSchema(dbPath);

  const limit = Math.max(1, Math.min(options.limit ?? DEFAULT_LIMIT, 16));
  let digests: RetrievedDigest[] = [];
  let fallback = false;

  try {
    const hits = await searchMemoryByEmbedding({
      panelHome: options.panelHome,
      query: options.query,
      limit
    });
    if (hits.length) {
      digests = hits.map((h) => ({ entry: h.entry, score: h.score }));
    } else {
      fallback = true;
    }
  } catch {
    fallback = true;
  }

  if (!digests.length) {
    fallback = true;
    const dailies = await listMemoryEntries(dbPath, { level: "daily", limit: Math.ceil(limit / 2) });
    const weeklies = await listMemoryEntries(dbPath, { level: "weekly", limit: Math.ceil(limit / 2) });
    const merged = [...dailies, ...weeklies].sort((a, b) => b.periodStartMs - a.periodStartMs);
    digests = merged.slice(0, limit).map((entry) => ({ entry }));
  }

  const citations: AgentCitation[] = [];
  for (let i = 0; i < digests.length; i++) {
    const { entry, score } = digests[i];
    const links = await listMemoryLinks(dbPath, entry.id);
    const first = links.find((l) => l.provider && l.agentSessionId);
    citations.push({
      index: i + 1,
      memoryId: entry.id,
      level: entry.level,
      title: entry.title || entry.id,
      score,
      periodStartMs: entry.periodStartMs,
      session: first
        ? {
            provider: first.provider as AgentProvider,
            id: first.agentSessionId as string,
            projectPath: first.projectPath || ""
          }
        : undefined
    });
  }

  // Truncate digests for prompt packing (mutate copy content only in ask)
  digests = digests.map((d) => ({
    ...d,
    entry: { ...d.entry, content: truncate(d.entry.content, CONTENT_CHARS) }
  }));

  return { digests, citations, fallback, dbPath };
}
