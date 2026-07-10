import { getSessionById } from "../catalog/query";
import { AgentProvider } from "../catalog/types";
import { chatCompletion } from "../llm/chat";
import { llmConfigFromSettings } from "../llm/fromSettings";
import { listMemoryLinks } from "../memory/store";
import { listMemoryEntries } from "../memory/store";
import { PanelSettings } from "../settings/types";
import { GtdProposal, GTD_STATUSES, isGtdStatus } from "../gtd/types";
import { getSessionGtdStatus } from "../gtd/store";

function truncate(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max)}\n[...truncated...]`;
}

export async function analyzeMemoryForGtd(input: {
  dbPath: string;
  settings: PanelSettings;
}): Promise<{ proposals: GtdProposal[]; warnings: string[]; raw?: string }> {
  const llm = llmConfigFromSettings(input.settings);
  if (!llm) {
    throw new Error(
      "LLM is not configured. Set llm.baseUrl, llm.model, and llm.apiKey in settings.json."
    );
  }

  // Prefer weekly + monthly for GTD triage; dailies as supporting context
  const weeklies = await listMemoryEntries(input.dbPath, { level: "weekly", limit: 8 });
  const monthlies = await listMemoryEntries(input.dbPath, { level: "monthly", limit: 6 });
  const dailies = await listMemoryEntries(input.dbPath, { level: "daily", limit: 8 });
  const digests = [...monthlies, ...weeklies, ...dailies];

  if (!digests.length) {
    return {
      proposals: [],
      warnings: ["No digests found. Generate weekly/monthly (and daily) memory first."]
    };
  }

  const sessionKeys = new Map<
    string,
    { provider: string; sessionId: string; title: string; projectPath: string; summary?: string; gtd?: string }
  >();

  for (const d of digests) {
    const links = await listMemoryLinks(input.dbPath, d.id);
    for (const link of links) {
      if (!link.provider || !link.agentSessionId) {
        continue;
      }
      const key = `${link.provider}:${link.agentSessionId}`;
      if (sessionKeys.has(key)) {
        continue;
      }
      const session = await getSessionById(
        input.dbPath,
        link.provider as AgentProvider,
        link.agentSessionId
      );
      if (!session) {
        continue;
      }
      const gtd = await getSessionGtdStatus(input.dbPath, session.provider, session.id);
      sessionKeys.set(key, {
        provider: session.provider,
        sessionId: session.id,
        title: session.title,
        projectPath: session.projectPath,
        summary: session.sessionSummary,
        gtd: gtd || undefined
      });
    }
  }

  const digestBlock = digests
    .map(
      (d, i) =>
        `### Digest ${i + 1}: ${d.level} · ${d.title || d.id}\nID: ${d.id}\n${truncate(d.content, 2500)}`
    )
    .join("\n\n");

  const sessionBlock =
    [...sessionKeys.values()]
      .map(
        (s) =>
          `- ${s.provider} | ${s.sessionId} | GTD=${s.gtd || "none"} | ${s.title} @ ${s.projectPath}${
            s.summary ? `\n  summary: ${truncate(s.summary, 400)}` : ""
          }`
      )
      .join("\n") || "(no linked sessions from digests — still propose only if session ids appear in digests)";

  const language = llm.outputLanguage || "zh-CN";
  const system = [
    "You triage coding-agent sessions into GTD for a developer.",
    "Statuses allowed: inbox, next, waiting, someday, reference.",
    "Prefer next for actionable unfinished work; waiting for blocked; someday for low priority; reference for docs/knowledge; inbox only if unclear.",
    "Prioritize insights from WEEKLY and MONTHLY digests; use daily digests as supporting detail.",
    "sourceMemoryIds should prefer weekly:/monthly: ids when those drove the proposal.",
    "Only include sessions that appear in the linked session list OR are clearly identified in digests with provider+id.",
    "Return STRICT JSON only, no markdown fence:",
    '{"items":[{"provider":"codex","sessionId":"...","gtd":"next","reason":"...","tasks":["..."],"sourceMemoryIds":["weekly:...","monthly:..."]}]}',
    `Write reason and tasks in language: ${language}.`
  ].join(" ");

  const user = [
    "## Memory digests (monthly + weekly first, then daily)",
    digestBlock,
    "",
    "## Linked sessions (prefer these ids)",
    sessionBlock,
    "",
    "Propose GTD updates and short task lists for sessions that still need work. Skip completed noise."
  ].join("\n");

  const raw = await chatCompletion(
    llm,
    [
      { role: "system", content: system },
      { role: "user", content: user }
    ],
    2500
  );

  const parsed = parseProposalsJson(raw);
  const warnings: string[] = [];
  const proposals: GtdProposal[] = [];

  for (const item of parsed) {
    if (!isGtdStatus(item.gtd)) {
      warnings.push(`skip invalid gtd: ${item.provider}/${item.sessionId} → ${item.gtd}`);
      continue;
    }
    const session = await getSessionById(
      input.dbPath,
      item.provider as AgentProvider,
      item.sessionId
    );
    if (!session) {
      warnings.push(`skip unknown session: ${item.provider}/${item.sessionId}`);
      continue;
    }
    proposals.push({
      provider: session.provider,
      sessionId: session.id,
      gtd: item.gtd,
      reason: item.reason || "AI triage from memory",
      tasks: Array.isArray(item.tasks) ? item.tasks.map(String).filter(Boolean).slice(0, 20) : [],
      sourceMemoryIds: Array.isArray(item.sourceMemoryIds)
        ? item.sourceMemoryIds.map(String)
        : []
    });
  }

  return { proposals, warnings, raw };
}

function parseProposalsJson(raw: string): Array<{
  provider: string;
  sessionId: string;
  gtd: string;
  reason?: string;
  tasks?: string[];
  sourceMemoryIds?: string[];
}> {
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) {
    text = fence[1].trim();
  }
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    text = text.slice(start, end + 1);
  }
  const data = JSON.parse(text) as { items?: unknown };
  if (!Array.isArray(data.items)) {
    return [];
  }
  return data.items
    .filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
    .map((x) => ({
      provider: String(x.provider || ""),
      sessionId: String(x.sessionId || x.session_id || ""),
      gtd: String(x.gtd || ""),
      reason: x.reason != null ? String(x.reason) : undefined,
      tasks: Array.isArray(x.tasks) ? x.tasks.map(String) : undefined,
      sourceMemoryIds: Array.isArray(x.sourceMemoryIds)
        ? x.sourceMemoryIds.map(String)
        : Array.isArray(x.source_memory_ids)
          ? (x.source_memory_ids as unknown[]).map(String)
          : undefined
    }))
    .filter((x) => x.provider && x.sessionId);
}

// silence unused if tree-shaken
void GTD_STATUSES;
