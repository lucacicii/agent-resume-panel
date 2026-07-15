import { getSessionById, listSessionsInRange } from "../catalog/query";
import { AgentProvider, AgentSession } from "../catalog/types";
import { chatCompletionDetailed } from "../llm/chat";
import { llmConfigFromSettings } from "../llm/fromSettings";
import { listReportLinks, getReportEntryById, listReportEntries } from "../report/store";
import { ReportEntry } from "../report/schema";
import { PanelSettings } from "../settings/types";
import { GtdProposal, isGtdStatus } from "../gtd/types";
import { getSessionGtdStatus } from "../gtd/store";
import { recordLlmUsage } from "../usage/store";

function truncate(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max)}\n[...truncated...]`;
}

export async function analyzeReportForGtd(input: {
  catalogDb: string;
  desktopDb: string;
  settings: PanelSettings;
  /** When set, only analyze these memory entry ids (scoped GTD). */
  reportIds?: string[];
}): Promise<{ proposals: GtdProposal[]; warnings: string[]; raw?: string }> {
  const llm = llmConfigFromSettings(input.settings);
  if (!llm) {
    throw new Error(
      "LLM is not configured. Set llm.baseUrl, llm.model, and llm.apiKey in settings.json."
    );
  }

  const scopedWarnings: string[] = [];
  let digests: ReportEntry[] = [];

  if (input.reportIds?.length) {
    for (const id of input.reportIds) {
      const entry = await getReportEntryById(input.desktopDb, id);
      if (entry) {
        digests.push(entry);
      } else {
        scopedWarnings.push(`memory entry not found: ${id}`);
      }
    }
  } else {
    // Prefer weekly + monthly for GTD triage; dailies as supporting context
    const weeklies = await listReportEntries(input.desktopDb, { level: "weekly", limit: 8 });
    const monthlies = await listReportEntries(input.desktopDb, { level: "monthly", limit: 6 });
    const dailies = await listReportEntries(input.desktopDb, { level: "daily", limit: 8 });
    digests = [...monthlies, ...weeklies, ...dailies];
  }

  if (!digests.length) {
    return {
      proposals: [],
      warnings: scopedWarnings.length
        ? scopedWarnings
        : ["No digests found. Generate weekly/monthly (and daily) memory first."]
    };
  }

  type SessionRow = {
    provider: string;
    sessionId: string;
    title: string;
    projectPath: string;
    summary?: string;
    gtd?: string;
  };
  const sessionKeys = new Map<string, SessionRow>();

  async function addSession(session: AgentSession): Promise<void> {
    const key = `${session.provider}:${session.id}`;
    if (sessionKeys.has(key)) return;
    const gtd = await getSessionGtdStatus(input.catalogDb, session.provider, session.id);
    sessionKeys.set(key, {
      provider: session.provider,
      sessionId: session.id,
      title: session.title,
      projectPath: session.projectPath,
      summary: session.sessionSummary,
      gtd: gtd || undefined
    });
  }

  // 1) Sessions linked via report_links
  let linkCount = 0;
  for (const d of digests) {
    const links = await listReportLinks(input.desktopDb, d.id);
    for (const link of links) {
      if (!link.provider || !link.agentSessionId) continue;
      const session = await getSessionById(
        input.catalogDb,
        link.provider as AgentProvider,
        link.agentSessionId
      );
      if (!session) continue;
      linkCount += 1;
      await addSession(session);
    }
  }

  // 2) Fallback / enrich: catalog sessions in each digest's time range
  // (critical for daily GTD when links are sparse or missing)
  for (const d of digests) {
    if (d.periodStartMs == null || d.periodEndMs == null) continue;
    const inRange = await listSessionsInRange(
      input.catalogDb,
      d.periodStartMs,
      d.periodEndMs,
      40
    );
    for (const session of inRange) {
      await addSession(session);
    }
  }

  if (!sessionKeys.size) {
    scopedWarnings.push(
      "该 digest 未关联到任何 catalog session（无 report_links，且周期内无 session）。无法生成 GTD 提议。"
    );
  } else if (linkCount === 0) {
    scopedWarnings.push(
      `report_links 为空，已按 digest 时间范围回退加载 ${sessionKeys.size} 个 session。`
    );
  }

  const digestBlock = digests
    .map(
      (d, i) =>
        `### Digest ${i + 1}: ${d.level} · ${d.title || d.id}\nID: ${d.id}\n${truncate(d.content, 2500)}`
    )
    .join("\n\n");

  const sessionList = [...sessionKeys.values()];
  const sessionBlock =
    sessionList
      .map(
        (s) =>
          `- ${s.provider} | ${s.sessionId} | GTD=${s.gtd || "none"} | ${s.title} @ ${s.projectPath}${
            s.summary ? `\n  summary: ${truncate(s.summary, 400)}` : ""
          }`
      )
      .join("\n") || "(no sessions available)";

  const language = llm.outputLanguage || "zh-CN";
  const scoped = Boolean(input.reportIds?.length);
  const digestIdsHint = digests.map((d) => d.id).join(", ");
  const system = [
    "You triage coding-agent sessions into GTD for a developer.",
    "Statuses allowed: inbox, next, waiting, someday, reference.",
    "Prefer next for actionable unfinished work; waiting for blocked; someday for low priority; reference for docs/knowledge; inbox only if unclear.",
    scoped
      ? "Analyze ONLY the provided digest(s) (daily/weekly/monthly all valid). Ground every proposal in that content."
      : "Prioritize insights from WEEKLY and MONTHLY digests; use daily digests as supporting detail.",
    `sourceReportIds should include these digest ids when relevant: ${digestIdsHint || "(from digests)"}.`,
    "You MUST only use provider+sessionId pairs from the Linked sessions list below.",
    "When the Linked sessions list is non-empty, produce at least one proposal per unfinished/active session when the digest mentions related work; use reference for pure knowledge sessions.",
    "Return ONLY one JSON object. No markdown fences, no commentary before or after.",
    'Schema: {"items":[{"provider":"codex","sessionId":"...","gtd":"next","reason":"...","tasks":["..."],"sourceReportIds":["daily:..."]}]}',
    "If Linked sessions is empty, return {\"items\":[]}.",
    `Write reason and tasks in language: ${language}.`
  ].join(" ");

  const user = [
    scoped
      ? "## Report digests (scoped — current selection only; daily is enough)"
      : "## Report digests (monthly + weekly first, then daily)",
    digestBlock,
    "",
    "## Linked sessions (use ONLY these provider|sessionId values)",
    sessionBlock,
    "",
    sessionList.length
      ? `There are ${sessionList.length} session(s). Propose GTD + short tasks for those that still need work.`
      : "No sessions linked — return {\"items\":[]}.",
    "Reply with JSON only."
  ].join("\n");

  const chatResult = await chatCompletionDetailed(
    llm,
    [
      { role: "system", content: system },
      { role: "user", content: user }
    ],
    2500
  );
  try {
    await recordLlmUsage(input.desktopDb, {
      kind: "chat",
      source: "gtd",
      model: chatResult.model,
      usage: chatResult.usage,
      durationMs: chatResult.durationMs,
      ok: true
    });
  } catch {
    // non-fatal
  }
  const raw = chatResult.content;

  const warnings: string[] = [...scopedWarnings];
  let parsed: Array<{
    provider: string;
    sessionId: string;
    gtd: string;
    reason?: string;
    tasks?: string[];
    sourceReportIds?: string[];
  }> = [];
  try {
    parsed = parseProposalsJson(raw);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    warnings.push(`LLM 返回的 JSON 无法解析: ${msg}`);
    return { proposals: [], warnings, raw };
  }

  const proposals: GtdProposal[] = [];

  for (const item of parsed) {
    if (!isGtdStatus(item.gtd)) {
      warnings.push(`skip invalid gtd: ${item.provider}/${item.sessionId} → ${item.gtd}`);
      continue;
    }
    const session = await getSessionById(
      input.catalogDb,
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
      sourceReportIds: Array.isArray(item.sourceReportIds)
        ? item.sourceReportIds.map(String)
        : []
    });
  }

  return { proposals, warnings, raw };
}

type ParsedProposal = {
  provider: string;
  sessionId: string;
  gtd: string;
  reason?: string;
  tasks?: string[];
  sourceReportIds?: string[];
};

function parseProposalsJson(raw: string): ParsedProposal[] {
  const candidates = collectJsonCandidates(raw);
  let lastError: Error | undefined;

  for (const candidate of candidates) {
    for (const variant of [candidate, repairCommonJsonIssues(candidate)]) {
      try {
        const data = JSON.parse(variant) as unknown;
        const items = extractItemsArray(data);
        if (items) {
          return mapProposalItems(items);
        }
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
      }
    }
  }

  const preview = raw.replace(/\s+/g, " ").trim().slice(0, 180);
  throw new Error(
    lastError
      ? `${lastError.message} · raw≈ ${preview}`
      : `No JSON object found · raw≈ ${preview}`
  );
}

/** Pull plausible JSON object/array substrings from model output. */
function collectJsonCandidates(raw: string): string[] {
  const out: string[] = [];
  let text = raw.trim();

  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) {
    text = fence[1].trim();
    out.push(text);
  }

  out.push(text);

  // Balanced {...} from each '{'
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== "{") continue;
    const slice = extractBalanced(text, i, "{", "}");
    if (slice) out.push(slice);
  }

  // Balanced [...] (some models return a bare array of items)
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== "[") continue;
    const slice = extractBalanced(text, i, "[", "]");
    if (slice) out.push(slice);
  }

  // Prefer longer candidates first (more complete JSON)
  return [...new Set(out)].sort((a, b) => b.length - a.length);
}

function extractBalanced(
  text: string,
  start: number,
  openCh: string,
  closeCh: string
): string | null {
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === "\\") {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === openCh) depth += 1;
    if (ch === closeCh) {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }
  return null;
}

function repairCommonJsonIssues(text: string): string {
  return (
    text
      // trailing commas before } or ]
      .replace(/,\s*([}\]])/g, "$1")
      // smart quotes
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/[\u2018\u2019]/g, "'")
  );
}

function extractItemsArray(data: unknown): unknown[] | null {
  if (!data) return null;
  if (Array.isArray(data)) {
    // Bare array of proposals
    return data;
  }
  if (typeof data === "object") {
    const obj = data as Record<string, unknown>;
    if (Array.isArray(obj.items)) return obj.items;
    if (Array.isArray(obj.proposals)) return obj.proposals;
    // Single proposal object
    if (obj.provider && (obj.sessionId || obj.session_id)) {
      return [obj];
    }
  }
  return null;
}

function mapProposalItems(items: unknown[]): ParsedProposal[] {
  return items
    .filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
    .map((x) => ({
      provider: String(x.provider || ""),
      sessionId: String(x.sessionId || x.session_id || ""),
      gtd: String(x.gtd || ""),
      reason: x.reason != null ? String(x.reason) : undefined,
      tasks: Array.isArray(x.tasks) ? x.tasks.map(String) : undefined,
      sourceReportIds: Array.isArray(x.sourceReportIds)
        ? x.sourceReportIds.map(String)
        : Array.isArray(x.source_report_ids)
          ? (x.source_report_ids as unknown[]).map(String)
          : undefined
    }))
    .filter((x) => x.provider && x.sessionId);
}
