import { useMemo, useState } from "react";
import { ThemeIcon } from "../../components/ThemeIcon";
import { useI18n } from "../../i18n";
import type {
  LinkGraphAnalyzeResult,
  LinkGraphHit,
  LinkGraphHop,
  LinkGraphHopRole,
  LinkGraphOutputLanguage,
  LinkGraphProgressEvent
} from "../../../shared/linkGraphTypes";

export type LinkGraphOpenTarget = {
  path: string;
  line: number;
  column?: number;
  endColumn?: number;
};

const LANGUAGE_OPTIONS: Array<{ value: LinkGraphOutputLanguage; labelKey: string }> = [
  { value: "auto", labelKey: "desktop.workbench.linkGraphLangAuto" },
  { value: "zh-cn", labelKey: "desktop.workbench.linkGraphLangZh" },
  { value: "en", labelKey: "desktop.workbench.linkGraphLangEn" },
  { value: "ja", labelKey: "desktop.workbench.linkGraphLangJa" }
];

/** Max cumulative evidence rows shown before "show more". */
const EVIDENCE_PREVIEW = 40;

type LlmHopIndex = Map<string, LinkGraphHop>;

function hopLookupKey(file: string, line: number): string {
  return `${file.replaceAll("\\", "/").replace(/^\.\//, "")}:${line}`;
}

function buildLlmHopIndex(hops: LinkGraphHop[]): LlmHopIndex {
  const map: LlmHopIndex = new Map();
  for (const hop of hops) {
    const file = hop.file.replaceAll("\\", "/").replace(/^\.\//, "");
    map.set(hopLookupKey(file, hop.line), hop);
    // Soft near-line keys so UI can still attach role when LLM line is off by 1–2.
    for (const delta of [-2, -1, 1, 2]) {
      const near = hop.line + delta;
      if (near < 1) continue;
      const key = hopLookupKey(file, near);
      if (!map.has(key)) map.set(key, hop);
    }
  }
  return map;
}

function findLlmHop(index: LlmHopIndex, relativePath: string, line: number): LinkGraphHop | undefined {
  const file = relativePath.replaceAll("\\", "/");
  return (
    index.get(hopLookupKey(file, line))
    || index.get(hopLookupKey(file.split("/").slice(-2).join("/"), line))
  );
}

function roleLabelKey(role: LinkGraphHopRole): string {
  return `desktop.workbench.linkGraphRole.${role}`;
}

export function LinkGraphSidePane({
  result,
  progress,
  busy,
  error,
  outputLanguage,
  onOutputLanguageChange,
  onRefresh,
  onContinue,
  onCancel,
  onOpen
}: {
  result: LinkGraphAnalyzeResult | null;
  progress: LinkGraphProgressEvent | null;
  busy: boolean;
  error: string | null;
  outputLanguage: LinkGraphOutputLanguage;
  onOutputLanguageChange: (value: LinkGraphOutputLanguage) => void;
  onRefresh?: () => void;
  onContinue?: () => void;
  onCancel?: () => void;
  onOpen: (target: LinkGraphOpenTarget) => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const [expandedHit, setExpandedHit] = useState<string | null>(null);
  const [showAllHits, setShowAllHits] = useState(false);
  const [evidenceExpanded, setEvidenceExpanded] = useState(false);

  const hits = result?.hits || [];
  const llmHops = result?.analysis?.hops || [];
  const frontierCount = result?.frontierCount ?? result?.frontier.length ?? 0;

  const llmHopIndex = useMemo(() => buildLlmHopIndex(llmHops), [llmHops]);

  /** Cumulative evidence timeline (depth asc). */
  const evidenceHits = useMemo(() => {
    return [...hits].sort(
      (a, b) => a.depth - b.depth || b.score - a.score || a.relativePath.localeCompare(b.relativePath) || a.line - b.line
    );
  }, [hits]);

  const visibleEvidence = evidenceExpanded ? evidenceHits : evidenceHits.slice(0, EVIDENCE_PREVIEW);

  const statusLabel = useMemo(() => {
    if (busy && progress?.phase === "analyzing") return t("desktop.workbench.linkGraphAnalyzing");
    if (busy) return t("desktop.workbench.linkGraphSearching");
    if (error) return error;
    if (!result) return t("desktop.workbench.linkGraphEmpty");
    if (result.complete) return t("desktop.workbench.linkGraphComplete");
    return t("desktop.workbench.linkGraphIncomplete", frontierCount, result.stopReason);
  }, [busy, error, frontierCount, progress?.phase, result, t]);

  const meta = result
    ? t(
      "desktop.workbench.linkGraphMeta",
      result.seed.symbol || result.seed.selection,
      result.reachedDepth,
      result.hits.length
    )
    : "";

  return (
    <div className="wb-side-pane wb-linkgraph-pane">
      <div className="wb-side-pane-head">
        <span className="wb-side-pane-title">{t("desktop.workbench.sidePanelLinkGraph")}</span>
        <div className="wb-linkgraph-head-actions">
          {busy ? (
            <button
              type="button"
              className="wb-git-action-btn"
              onClick={() => onCancel?.()}
              aria-label={t("desktop.common.cancel")}
              title={t("desktop.common.cancel")}
            >
              <ThemeIcon name="close" size={14} />
            </button>
          ) : (
            <button
              type="button"
              className="wb-git-action-btn"
              disabled={!result || !onRefresh}
              onClick={() => onRefresh?.()}
              aria-label={t("desktop.common.refresh")}
              title={t("desktop.common.refresh")}
            >
              <ThemeIcon name="refresh" size={14} />
            </button>
          )}
        </div>
      </div>

      <div className="wb-linkgraph-body">
        {meta ? <p className="wb-linkgraph-meta muted">{meta}</p> : null}
        <label className="wb-linkgraph-lang">
          <span className="wb-linkgraph-lang-label">{t("desktop.workbench.linkGraphSummaryLanguage")}</span>
          <select
            className="wb-linkgraph-lang-select"
            value={outputLanguage}
            disabled={busy}
            aria-label={t("desktop.workbench.linkGraphSummaryLanguage")}
            onChange={(event) => onOutputLanguageChange(event.target.value as LinkGraphOutputLanguage)}
          >
            {LANGUAGE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{t(option.labelKey)}</option>
            ))}
          </select>
        </label>
        <p className={`wb-linkgraph-status${error ? " is-error" : ""}${busy ? " is-busy" : ""}`}>
          {busy ? <ThemeIcon name="loader" className="spin" size={14} aria-hidden="true" /> : null}
          <span>{statusLabel}</span>
        </p>

        {result?.analysis?.summary ? (
          <section className="wb-linkgraph-section">
            <h3 className="wb-linkgraph-section-title">{t("desktop.workbench.linkGraphSummary")}</h3>
            <p className="wb-linkgraph-summary">{result.analysis.summary}</p>
            {result.llmStatus === "unconfigured" ? (
              <p className="muted wb-linkgraph-hint">{t("desktop.workbench.linkGraphLlmUnconfigured")}</p>
            ) : null}
            {result.llmStatus === "failed" ? (
              <p className="muted wb-linkgraph-hint">{t("desktop.workbench.linkGraphLlmFailed", result.llmError || "")}</p>
            ) : null}
          </section>
        ) : null}

        {/* LLM main path: role + title + narrative (restored) */}
        {llmHops.length ? (
          <section className="wb-linkgraph-section">
            <h3 className="wb-linkgraph-section-title">
              {t("desktop.workbench.linkGraphMainPath")} · {llmHops.length}
            </h3>
            <p className="muted wb-linkgraph-hint">{t("desktop.workbench.linkGraphMainPathHint")}</p>
            <ol className="wb-linkgraph-chain">
              {llmHops.map((hop) => (
                <li key={hop.id} className="wb-linkgraph-hop is-llm-path">
                  <button
                    type="button"
                    className="wb-linkgraph-hop-main"
                    onClick={() => {
                      const absolute = absolutePathForFile(result, hop.file);
                      onOpen({ path: absolute, line: hop.line });
                    }}
                    title={`${hop.file}:${hop.line}`}
                  >
                    <span className={`wb-linkgraph-role is-${hop.role}`}>
                      {t(roleLabelKey(hop.role))}
                    </span>
                    <span className="wb-linkgraph-hop-title">{hop.title || hop.file}</span>
                    <span className="wb-linkgraph-hop-loc muted">{hop.file}:{hop.line}</span>
                    {hop.narrative ? (
                      <span className="wb-linkgraph-hop-narrative">{hop.narrative}</span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ol>
          </section>
        ) : null}

        {/* Cumulative evidence: keeps growing with Continue; attach LLM role when matched */}
        {evidenceHits.length ? (
          <section className="wb-linkgraph-section">
            <h3 className="wb-linkgraph-section-title">
              {t("desktop.workbench.linkGraphEvidence")} · {evidenceHits.length}
            </h3>
            <p className="muted wb-linkgraph-hint">{t("desktop.workbench.linkGraphChainCumulativeHint")}</p>
            <ol className="wb-linkgraph-chain">
              {visibleEvidence.map((hit) => {
                const key = hitKey(hit);
                const llm = findLlmHop(llmHopIndex, hit.relativePath, hit.line);
                return (
                  <li key={key} className={`wb-linkgraph-hop${llm ? " is-llm-path" : ""}`}>
                    <button
                      type="button"
                      className="wb-linkgraph-hop-main"
                      onClick={() => onOpen({
                        path: hit.path,
                        line: hit.line,
                        column: hit.column,
                        endColumn: hit.endColumn
                      })}
                      title={`${hit.relativePath}:${hit.line}`}
                    >
                      <span className="wb-linkgraph-hit-depth">d{hit.depth}</span>
                      {llm ? (
                        <span className={`wb-linkgraph-role is-${llm.role}`}>
                          {t(roleLabelKey(llm.role))}
                        </span>
                      ) : null}
                      <span className="wb-linkgraph-hop-title">
                        {llm?.title || hit.symbol}
                      </span>
                      <span className="wb-linkgraph-hop-loc muted">{hit.relativePath}:{hit.line}</span>
                      <span className="wb-linkgraph-hop-narrative">
                        {llm?.narrative || hit.preview}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
            {evidenceHits.length > EVIDENCE_PREVIEW ? (
              <button
                type="button"
                className="wb-linkgraph-section-toggle"
                onClick={() => setEvidenceExpanded((value) => !value)}
              >
                {evidenceExpanded
                  ? t("desktop.workbench.linkGraphShowLess")
                  : t("desktop.workbench.linkGraphShowMore", evidenceHits.length - EVIDENCE_PREVIEW)}
              </button>
            ) : null}
          </section>
        ) : null}

        {result && !result.complete && frontierCount > 0 ? (
          <div className="wb-linkgraph-continue">
            <button type="button" className="tool-btn" disabled={busy || !onContinue} onClick={() => onContinue?.()}>
              {t("desktop.workbench.linkGraphContinue", frontierCount)}
            </button>
          </div>
        ) : null}

        {hits.length ? (
          <section className="wb-linkgraph-section">
            <button
              type="button"
              className="wb-linkgraph-section-toggle"
              aria-expanded={showAllHits}
              onClick={() => setShowAllHits((value) => !value)}
            >
              <ThemeIcon name="chevron-right" className={showAllHits ? "is-expanded" : ""} size={12} />
              <span className="wb-linkgraph-section-title">
                {t("desktop.workbench.linkGraphAllHits", hits.length)}
              </span>
            </button>
            {showAllHits ? (
              <ul className="wb-linkgraph-hits">
                {hits.map((hit) => {
                  const key = hitKey(hit);
                  const open = expandedHit === key;
                  const llm = findLlmHop(llmHopIndex, hit.relativePath, hit.line);
                  return (
                    <li key={key} className="wb-linkgraph-hit">
                      <button
                        type="button"
                        className="wb-linkgraph-hit-main"
                        onClick={() => onOpen({
                          path: hit.path,
                          line: hit.line,
                          column: hit.column,
                          endColumn: hit.endColumn
                        })}
                      >
                        <span className="wb-linkgraph-hit-depth">d{hit.depth}</span>
                        {llm ? (
                          <span className={`wb-linkgraph-role is-${llm.role}`}>
                            {t(roleLabelKey(llm.role))}
                          </span>
                        ) : null}
                        <span className="wb-linkgraph-hit-path">{hit.relativePath}:{hit.line}</span>
                        <span className="wb-linkgraph-hit-preview muted">
                          {llm?.narrative || hit.preview}
                        </span>
                      </button>
                      <button
                        type="button"
                        className="wb-linkgraph-hit-expand"
                        aria-expanded={open}
                        aria-label={t("desktop.workbench.linkGraphTogglePreview")}
                        onClick={() => setExpandedHit(open ? null : key)}
                      >
                        <ThemeIcon name="chevron-right" className={open ? "is-expanded" : ""} size={12} />
                      </button>
                      {open ? (
                        <pre className="wb-linkgraph-hit-snippet">
                          {llm?.narrative ? `${llm.narrative}\n\n${hit.preview}` : hit.preview}
                        </pre>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </section>
        ) : null}

        {!busy && !error && !result ? (
          <p className="muted wb-linkgraph-empty">{t("desktop.workbench.linkGraphHint")}</p>
        ) : null}
      </div>
    </div>
  );
}

function hitKey(hit: LinkGraphHit): string {
  return `${hit.relativePath}:${hit.line}:${hit.symbol}:${hit.depth}`;
}

/** Prefer absolute hit paths so openFile/inspectFile stay within the project root. */
function absolutePathForFile(result: LinkGraphAnalyzeResult | null, file: string): string {
  const normalized = file.replaceAll("\\", "/");
  if (normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized)) {
    return file;
  }
  const exact = result?.hits.find((hit) => hit.relativePath === normalized && hit.path);
  if (exact) return exact.path;
  const sameFile = result?.hits.find((hit) => hit.relativePath === normalized || hit.relativePath.endsWith(`/${normalized}`));
  if (sameFile) return sameFile.path;
  return normalized;
}
