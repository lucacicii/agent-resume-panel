import { useEffect, useMemo, useState } from "react";
import { ThemeIcon } from "../../components/ThemeIcon";
import { useI18n } from "../../i18n";
import type {
  LinkGraphAnalyzeResult,
  LinkGraphChainStep,
  LinkGraphHopRole,
  LinkGraphOutputLanguage,
  LinkGraphProgressEvent,
  LinkGraphTimelineItem
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

function roleLabelKey(role: LinkGraphHopRole): string {
  return `desktop.workbench.linkGraphRole.${role}`;
}

function stepEntryLabel(steps: LinkGraphChainStep[], fallback: string): string {
  if (!steps.length) return fallback;
  return `${steps[0].file}:${steps[0].line}`;
}

export function LinkGraphSidePane({
  result,
  progress,
  busy,
  error,
  outputLanguage,
  onOutputLanguageChange,
  onRefresh,
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
  onCancel?: () => void;
  onOpen: (target: LinkGraphOpenTarget) => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const [chainOpen, setChainOpen] = useState(true);
  const [pageRefsOpen, setPageRefsOpen] = useState<string | null>(null);
  const [openEndsOpen, setOpenEndsOpen] = useState(true);
  const [timelineOpen, setTimelineOpen] = useState(true);

  const primaryChain = result?.primaryChain || [];
  const openEnds = result?.openEnds || result?.analysis?.openEnds || [];
  const bridgeStatus = result?.bridgeStatus;

  const timeline: LinkGraphTimelineItem[] = useMemo(() => {
    if (progress?.timeline?.length) return progress.timeline;
    return result?.timeline || [];
  }, [progress?.timeline, result?.timeline]);

  const mainSteps: LinkGraphChainStep[] = useMemo(() => {
    if (primaryChain.length) return primaryChain;
    return (result?.analysis?.hops || []).map((hop) => ({
      id: hop.id,
      edgeKind:
        hop.role === "bridge"
          ? ("bridge" as const)
          : hop.role === "import"
            ? ("imports" as const)
            : ("defines" as const),
      nodeKind: "unknown" as const,
      role: hop.role,
      title: hop.title,
      narrative: hop.narrative,
      file: hop.file,
      path: absolutePathForFile(result, hop.file),
      line: hop.line,
      symbol: result?.seed.symbol || "",
      preview: hop.narrative,
      confidence: hop.confidence,
      bridgeKind: hop.bridgeKind
    }));
  }, [primaryChain, result]);

  const hasBridge = mainSteps.some((s) => s.edgeKind === "bridge");
  const hasTerminal = mainSteps.some((s) => s.terminal);

  const statusLabel = useMemo(() => {
    if (busy && progress?.phase === "analyzing") return t("desktop.workbench.linkGraphAnalyzing");
    if (busy) return progress?.message || t("desktop.workbench.linkGraphSearching");
    if (error) return error;
    if (!result) return t("desktop.workbench.linkGraphEmpty");
    if (result.stopReason === "time_budget") return t("desktop.workbench.linkGraphTimedOut");
    if (result.stopReason === "cancelled") return t("desktop.common.cancel");
    return t("desktop.workbench.linkGraphComplete");
  }, [busy, error, progress?.message, progress?.phase, result, t]);

  const meta = result
    ? t(
      "desktop.workbench.linkGraphMetaChains",
      result.seed.symbol || result.seed.selection,
      mainSteps.length
    )
    : "";

  useEffect(() => {
    if (result?.requestId) {
      setChainOpen(true);
      setPageRefsOpen(null);
      setOpenEndsOpen(true);
    }
  }, [result?.requestId]);

  const openStep = (step: LinkGraphChainStep, lineOverride?: number) => {
    onOpen({
      path: step.path || absolutePathForFile(result, step.file),
      line: lineOverride ?? step.line,
      column: step.column,
      endColumn: step.endColumn
    });
  };

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

        {timeline.length ? (
          <section className="wb-linkgraph-section">
            <button
              type="button"
              className="wb-linkgraph-section-toggle"
              aria-expanded={timelineOpen}
              onClick={() => setTimelineOpen((v) => !v)}
            >
              <ThemeIcon name="chevron-right" className={timelineOpen ? "is-expanded" : ""} size={12} />
              <span className="wb-linkgraph-section-title">
                {t("desktop.workbench.linkGraphTimeline")} · {timeline.length}
              </span>
            </button>
            {timelineOpen ? (
              <ol className="wb-linkgraph-timeline">
                {timeline.map((item) => (
                  <li
                    key={item.id}
                    className={`wb-linkgraph-timeline-item is-${item.status}`}
                  >
                    <span className="wb-linkgraph-timeline-status" aria-hidden="true">
                      {item.status === "running" ? (
                        <ThemeIcon name="loader" className="spin" size={12} />
                      ) : item.status === "done" ? (
                        "✓"
                      ) : item.status === "failed" ? (
                        "!"
                      ) : (
                        "·"
                      )}
                    </span>
                    <div className="wb-linkgraph-timeline-body">
                      <div className="wb-linkgraph-timeline-title">
                        <span className="wb-linkgraph-timeline-phase">{item.phase}</span>
                        {item.title}
                      </div>
                      {item.detail ? (
                        <p className="wb-linkgraph-timeline-detail muted">{item.detail}</p>
                      ) : null}
                      {item.evidence?.length ? (
                        <ul className="wb-linkgraph-timeline-evidence">
                          {item.evidence.map((ev, i) => (
                            <li key={`${item.id}_ev_${i}`}>
                              <button
                                type="button"
                                className="wb-linkgraph-timeline-ev-btn"
                                onClick={() => onOpen({
                                  path: ev.path || absolutePathForFile(result, ev.file),
                                  line: ev.line
                                })}
                              >
                                <span className="muted">{ev.file}:{ev.line}</span>
                                {ev.preview ? <span>{ev.preview}</span> : null}
                              </button>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ol>
            ) : null}
          </section>
        ) : null}

        {result?.analysis?.summary || result?.llmStatus === "unconfigured" || result?.llmStatus === "failed" ? (
          <section className="wb-linkgraph-section">
            <h3 className="wb-linkgraph-section-title">{t("desktop.workbench.linkGraphSummary")}</h3>
            {result.analysis?.summary ? (
              <p className="wb-linkgraph-summary">{result.analysis.summary}</p>
            ) : null}
            {result.llmStatus === "unconfigured" ? (
              <p className="muted wb-linkgraph-hint">{t("desktop.workbench.linkGraphLlmUnconfigured")}</p>
            ) : null}
            {result.llmStatus === "failed" ? (
              <p className="muted wb-linkgraph-hint">{t("desktop.workbench.linkGraphLlmFailed", result.llmError || "")}</p>
            ) : null}
            {bridgeStatus && bridgeStatus !== "skipped" ? (
              <p className="muted wb-linkgraph-hint">
                {t(`desktop.workbench.linkGraphBridge.${bridgeStatus}`)}
              </p>
            ) : null}
          </section>
        ) : null}

        {mainSteps.length ? (
          <section className="wb-linkgraph-section">
            <h3 className="wb-linkgraph-section-title">
              {t("desktop.workbench.linkGraphPrimaryChain")}
            </h3>
            <p className="muted wb-linkgraph-hint">
              {stepEntryLabel(mainSteps, result?.seed.relativePath || "")}
              {" · "}
              {t("desktop.workbench.linkGraphStepCount", mainSteps.length)}
            </p>
            <div className={`wb-linkgraph-group is-primary${chainOpen ? " is-open" : ""}`}>
              <button
                type="button"
                className="wb-linkgraph-group-head"
                aria-expanded={chainOpen}
                onClick={() => setChainOpen((v) => !v)}
              >
                <ThemeIcon name="chevron-right" className={chainOpen ? "is-expanded" : ""} size={12} />
                <span className="wb-linkgraph-group-title">{t("desktop.workbench.linkGraphPrimaryChain")}</span>
                <span className="wb-linkgraph-group-meta muted">
                  {t("desktop.workbench.linkGraphStepCount", mainSteps.length)}
                </span>
                {hasBridge ? (
                  <span className="wb-linkgraph-bridge-badge">{t("desktop.workbench.linkGraphBadgeBridge")}</span>
                ) : null}
                {hasTerminal ? (
                  <span className="wb-linkgraph-terminal-badge">{t("desktop.workbench.linkGraphBadgeVo")}</span>
                ) : null}
              </button>
              {chainOpen ? (
                <ol className="wb-linkgraph-chain wb-linkgraph-group-steps">
                  {mainSteps.map((step, index) => (
                    <li
                      key={step.id}
                      className={`wb-linkgraph-hop${step.edgeKind === "bridge" ? " is-bridge" : ""}${step.terminal ? " is-terminal" : ""}`}
                    >
                      <button
                        type="button"
                        className="wb-linkgraph-hop-main"
                        onClick={() => openStep(step)}
                        title={`${step.file}:${step.line}`}
                      >
                        <span className="wb-linkgraph-step-index">{index + 1}</span>
                        <span className={`wb-linkgraph-role is-${step.role}`}>
                          {t(roleLabelKey(step.role))}
                        </span>
                        {step.bridgeKind ? (
                          <span className="wb-linkgraph-bridge-badge">{step.bridgeKind}</span>
                        ) : null}
                        <span className="wb-linkgraph-hop-title">{step.title || step.file}</span>
                        <span className="wb-linkgraph-hop-loc muted">{step.file}:{step.line}</span>
                        {step.narrative || step.preview ? (
                          <span className="wb-linkgraph-hop-narrative">{step.narrative || step.preview}</span>
                        ) : null}
                      </button>
                      {step.pageRefs?.length ? (
                        <div className="wb-linkgraph-page-refs">
                          <button
                            type="button"
                            className="wb-linkgraph-section-toggle"
                            onClick={() => setPageRefsOpen((id) => (id === step.id ? null : step.id))}
                          >
                            {t("desktop.workbench.linkGraphPageRefs", step.pageRefs.length)}
                          </button>
                          {pageRefsOpen === step.id ? (
                            <ul className="wb-linkgraph-page-ref-list">
                              {step.pageRefs.map((ref) => (
                                <li key={`${step.id}_${ref.line}_${ref.column}`}>
                                  <button
                                    type="button"
                                    className="wb-linkgraph-page-ref-btn"
                                    onClick={() => openStep(step, ref.line)}
                                  >
                                    <span className="muted">L{ref.line}</span>
                                    <span>{ref.preview}</span>
                                  </button>
                                </li>
                              ))}
                            </ul>
                          ) : null}
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ol>
              ) : null}
            </div>
          </section>
        ) : null}

        {openEnds.length ? (
          <section className="wb-linkgraph-section">
            <button
              type="button"
              className="wb-linkgraph-section-toggle"
              aria-expanded={openEndsOpen}
              onClick={() => setOpenEndsOpen((v) => !v)}
            >
              <ThemeIcon name="chevron-right" className={openEndsOpen ? "is-expanded" : ""} size={12} />
              <span className="wb-linkgraph-section-title">
                {t("desktop.workbench.linkGraphOpenEnds")} · {openEnds.length}
              </span>
            </button>
            {openEndsOpen ? (
              <ul className="wb-linkgraph-open-ends">
                {openEnds.map((item, i) => (
                  <li key={`${item.reason}_${item.file}_${item.line}_${i}`} className="muted">
                    <code>{item.reason}</code>
                    {item.file ? ` · ${item.file}${item.line ? `:${item.line}` : ""}` : ""}
                    {item.symbol ? ` · ${item.symbol}` : ""}
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        ) : null}

        {!busy && !error && !result ? (
          <p className="muted wb-linkgraph-empty">{t("desktop.workbench.linkGraphHint")}</p>
        ) : null}

        {!busy && result && !mainSteps.length ? (
          <p className="muted wb-linkgraph-empty">{t("desktop.workbench.linkGraphNoChains")}</p>
        ) : null}
      </div>
    </div>
  );
}

function absolutePathForFile(result: LinkGraphAnalyzeResult | null, file: string): string {
  const normalized = file.replaceAll("\\", "/");
  if (normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized)) return file;
  const exact = result?.hits.find((hit) => hit.relativePath === normalized && hit.path);
  if (exact) return exact.path;
  const chain = result?.primaryChain?.find((s) => s.file === normalized && s.path);
  if (chain) return chain.path;
  const sameFile = result?.hits.find(
    (hit) => hit.relativePath === normalized || hit.relativePath.endsWith(`/${normalized}`)
  );
  if (sameFile) return sameFile.path;
  return normalized;
}
