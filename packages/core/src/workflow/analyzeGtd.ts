import { getSessionById, listSessionsInRange } from "../catalog/query";
import { AgentProvider, AgentSession } from "../catalog/types";
import { chatCompletionDetailed } from "../llm/chat";
import { DEFAULT_CATALOG_OUTPUT_LANGUAGE } from "../i18n/outputLanguage";
import { createUiText } from "../i18n/uiText";
import { llmConfigFromSettings } from "../llm/fromSettings";
import { listReportLinks, getReportEntryById, listReportEntries } from "../report/store";
import { ReportEntry } from "../report/schema";
import { PanelSettings } from "../settings/types";
import { GtdEvidence, GtdProposal, isActiveGtdStatus } from "../gtd/types";
import { getSessionGtdStatus } from "../gtd/store";
import { recordLlmUsage } from "../usage/store";
import { ensureSummariesForSessions } from "../session/ensureSummaries";

function truncate(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max)}\n[...truncated...]`;
}

export interface ReportGtdCandidate {
  provider: string;
  sessionId: string;
  gtd: string;
  reason?: string;
  tasks?: string[];
  sourceReportIds?: string[];
  evidence?: Partial<GtdEvidence>;
}

export interface ReportGtdEvidenceSource {
  id: string;
  text: string;
}

function evidenceText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function isTraceableQuote(
  quote: string | undefined,
  source: string | undefined,
  sources: ReadonlyMap<string, string>
): boolean {
  const normalized = evidenceText(quote || "");
  if (normalized.length < 3 || normalized.length > 320 || !source) {
    return false;
  }
  return evidenceText(sources.get(source) || "").includes(normalized);
}

/**
 * Treat model output as untrusted. A next action needs two independently traceable
 * excerpts so a completed or ambiguous session cannot become next by default.
 */
export function filterReportGtdProposals(input: {
  candidates: ReportGtdCandidate[];
  sessionKeys: ReadonlySet<string>;
  reportIds: ReadonlySet<string>;
  evidenceSources: ReportGtdEvidenceSource[];
}): { proposals: GtdProposal[]; warnings: string[] } {
  const evidenceSources = new Map(input.evidenceSources.map((source) => [source.id, source.text]));
  const seen = new Set<string>();
  const warnings: string[] = [];
  const proposals: GtdProposal[] = [];

  for (const item of input.candidates) {
    const key = `${item.provider}:${item.sessionId}`;
    if (!isActiveGtdStatus(item.gtd)) {
      warnings.push(`skip invalid gtd: ${key} → ${item.gtd}`);
      continue;
    }
    if (!input.sessionKeys.has(key)) {
      warnings.push(`skip unavailable session: ${key}`);
      continue;
    }
    if (seen.has(key)) {
      warnings.push(`skip duplicate proposal: ${key}`);
      continue;
    }

    const sourceReportIds = (item.sourceReportIds || []).filter((id) => input.reportIds.has(id));
    if (!sourceReportIds.length) {
      warnings.push(`skip proposal without current report source: ${key}`);
      continue;
    }

    const tasks = (item.tasks || []).map(String).map((task) => task.trim()).filter(Boolean).slice(0, 20);
    if (item.gtd === "next") {
      const evidence = item.evidence as GtdEvidence | undefined;
      const hasUnresolved = isTraceableQuote(
        evidence?.unresolved?.quote,
        evidence?.unresolved?.source,
        evidenceSources
      );
      const hasNextAction = isTraceableQuote(
        evidence?.nextAction?.quote,
        evidence?.nextAction?.source,
        evidenceSources
      );
      if (!tasks.length || !hasUnresolved || !hasNextAction) {
        warnings.push(`skip unverified next action: ${key}`);
        continue;
      }
      proposals.push({
        provider: item.provider,
        sessionId: item.sessionId,
        gtd: item.gtd,
        reason: item.reason?.trim() || "AI triage from memory",
        tasks,
        sourceReportIds,
        evidence
      });
      seen.add(key);
      continue;
    }

    proposals.push({
      provider: item.provider,
      sessionId: item.sessionId,
      gtd: item.gtd,
      reason: item.reason?.trim() || "AI triage from memory",
      tasks,
      sourceReportIds
    });
    seen.add(key);
  }

  return { proposals, warnings };
}

export async function analyzeReportForGtd(input: {
  catalogDb: string;
  desktopDb: string;
  settings: PanelSettings;
  /** When set, only analyze these memory entry ids (scoped GTD). */
  reportIds?: string[];
  systemLocale?: string;
}): Promise<{ proposals: GtdProposal[]; warnings: string[]; raw?: string }> {
  const pt = createUiText(input.settings, input.systemLocale);
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
  const sessionsByKey = new Map<string, AgentSession>();

  async function addSession(session: AgentSession): Promise<void> {
    const key = `${session.provider}:${session.id}`;
    if (!sessionsByKey.has(key)) sessionsByKey.set(key, session);
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

  if (!sessionsByKey.size) {
    scopedWarnings.push(pt("desktop.report.gtdNoLinkedSessions"));
  } else if (linkCount === 0) {
    scopedWarnings.push(pt("desktop.report.gtdFallbackSessions", sessionsByKey.size));
  }

  const initialSessions = [...sessionsByKey.values()];
  const needsFreshSummary = new Set(
    initialSessions
      .filter(
        (session) =>
          !session.sessionSummary?.trim() ||
          session.sessionSummaryAtMs == null ||
          session.updatedAt > session.sessionSummaryAtMs
      )
      .map((session) => `${session.provider}:${session.id}`)
  );
  const ensured = await ensureSummariesForSessions({
    dbPath: input.catalogDb,
    sessions: initialSessions,
    settings: input.settings,
    refreshIfStale: true,
    concurrency: 2,
    systemLocale: input.systemLocale,
    jobKeyPrefix: "summarize:gtd"
  });
  const unavailableSessions = new Set(
    ensured.failed
      .map((failure) => failure.key)
      .filter((key) => needsFreshSummary.has(key))
  );
  if (unavailableSessions.size) {
    scopedWarnings.push(`GTD skipped ${unavailableSessions.size} session(s) whose current summary could not be refreshed.`);
  }

  const sessionList: SessionRow[] = [];
  for (const session of ensured.sessions) {
    const key = `${session.provider}:${session.id}`;
    if (unavailableSessions.has(key)) continue;
    const gtd = await getSessionGtdStatus(input.catalogDb, session.provider, session.id);
    sessionList.push({
      provider: session.provider,
      sessionId: session.id,
      title: session.title,
      projectPath: session.projectPath,
      summary: session.sessionSummary,
      gtd: gtd || undefined
    });
  }

  const digestBlock = digests
    .map(
      (d, i) =>
        `### Report report:${d.id} (${i + 1}): ${d.level} · ${d.title || d.id}\nID: ${d.id}\n${truncate(d.content, 2500)}`
    )
    .join("\n\n");

  const sessionBlock =
    sessionList
        .map(
          (s) =>
          `### Session session:${s.provider}:${s.sessionId}\n- GTD=${s.gtd || "none"} | ${s.title} @ ${s.projectPath}${
            s.summary ? `\n  summary: ${truncate(s.summary, 400)}` : ""
          }`
      )
      .join("\n") || "(no sessions available)";

  const language = llm.outputLanguage || DEFAULT_CATALOG_OUTPUT_LANGUAGE;
  const scoped = Boolean(input.reportIds?.length);
  const digestIdsHint = digests.map((d) => d.id).join(", ");
  const system = [
    "You triage coding-agent sessions into GTD for a developer.",
    "Statuses allowed: inbox, next, waiting, someday, reference. Done is a human-only completion state and must never appear in items.",
    "Default to no proposal. Completed work without separate explicit follow-up MUST NOT appear in items.",
    "Use next only when two distinct facts are explicit: unresolved work and a concrete next action. Never infer either from a prior GTD label, a title, or a generic aspiration.",
    "Use waiting only for an explicit external dependency; someday only for explicitly deferred work; reference only for durable knowledge. Omit unclear or completed sessions.",
    scoped
      ? "Analyze ONLY the provided digest(s) (daily/weekly/monthly all valid). Ground every proposal in that content."
      : "Prioritize insights from WEEKLY and MONTHLY digests; use daily digests as supporting detail.",
    `sourceReportIds should include these digest ids when relevant: ${digestIdsHint || "(from digests)"}.`,
    "You MUST only use provider+sessionId pairs from the Linked sessions list below.",
    "Existing GTD labels are reference-only and are never evidence for a proposal.",
    "Return ONLY one JSON object. No markdown fences, no commentary before or after.",
    'For gtd=next, evidence is required and each quote must be an exact short quote from a named source below. Schema: {"items":[{"provider":"codex","sessionId":"...","gtd":"next","reason":"...","tasks":["..."],"sourceReportIds":["daily:..."],"evidence":{"unresolved":{"source":"report:daily:...","quote":"..."},"nextAction":{"source":"session:codex:...","quote":"..."}}}]}',
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
      ? `There are ${sessionList.length} session(s). Return only high-confidence GTD proposals; an empty items array is correct when no concrete action remains.`
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
  let parsed: ReportGtdCandidate[] = [];
  try {
    parsed = parseProposalsJson(raw);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    warnings.push(pt("desktop.report.gtdJsonParseFailed", msg));
    return { proposals: [], warnings, raw };
  }

  const filtered = filterReportGtdProposals({
    candidates: parsed,
    sessionKeys: new Set(sessionList.map((session) => `${session.provider}:${session.sessionId}`)),
    reportIds: new Set(digests.map((digest) => digest.id)),
    evidenceSources: [
      ...digests.map((digest) => ({ id: `report:${digest.id}`, text: truncate(digest.content, 2500) })),
      ...sessionList.map((session) => ({
        id: `session:${session.provider}:${session.sessionId}`,
        text: truncate(session.summary || "", 400)
      }))
    ]
  });
  warnings.push(...filtered.warnings);
  return { proposals: filtered.proposals, warnings, raw };
}

type ParsedProposal = ReportGtdCandidate;

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
          : undefined,
      evidence: toEvidence(x.evidence)
    }))
    .filter((x) => x.provider && x.sessionId);
}

function toEvidence(value: unknown): Partial<GtdEvidence> | undefined {
  if (!value || typeof value !== "object") return undefined;
  const source = value as Record<string, unknown>;
  const quote = (key: "unresolved" | "nextAction"): { source: string; quote: string } | undefined => {
    const item = source[key];
    if (!item || typeof item !== "object") return undefined;
    const entry = item as Record<string, unknown>;
    return { source: String(entry.source || ""), quote: String(entry.quote || "") };
  };
  return { unresolved: quote("unresolved"), nextAction: quote("nextAction") };
}
