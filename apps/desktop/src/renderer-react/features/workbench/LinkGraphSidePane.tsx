import { useEffect, useMemo, useState } from "react";
import { ThemeIcon } from "../../components/ThemeIcon";
import { useI18n } from "../../i18n";
import type {
  LinkGraphAnalyzeResult,
  LinkGraphChainStep,
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

type ChainGroupModel = {
  id: string;
  kind: "primary" | "branch";
  title: string;
  subtitle?: string;
  steps: LinkGraphChainStep[];
  hasBridge: boolean;
  hasTerminal: boolean;
};

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
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set(["primary"]));
  const [prunedOpen, setPrunedOpen] = useState(false);
  const [pageRefsOpen, setPageRefsOpen] = useState<string | null>(null);
  const [openEndsOpen, setOpenEndsOpen] = useState(true);

  const primaryChain = result?.primaryChain || [];
  const branches = result?.branches || [];
  const openEnds = result?.openEnds || result?.analysis?.openEnds || [];
  const discardedCount = result?.discardedCount ?? 0;
  const truncatedBranchCount = result?.truncatedBranchCount ?? 0;
  const bridgeStatus = result?.bridgeStatus;

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

  const groups = useMemo((): ChainGroupModel[] => {
    const out: ChainGroupModel[] = [];
    if (mainSteps.length) {
      out.push({
        id: "primary",
        kind: "primary",
        title: t("desktop.workbench.linkGraphPrimaryChain"),
        subtitle: stepEntryLabel(mainSteps, result?.seed.relativePath || ""),
        steps: mainSteps,
        hasBridge: mainSteps.some((s) => s.edgeKind === "bridge"),
        hasTerminal: mainSteps.some((s) => s.terminal)
      });
    }
    for (const branch of branches.filter((b) => !b.pruned)) {
      out.push({
        id: branch.id,
        kind: "branch",
        title: t("desktop.workbench.linkGraphBranchGroup", branch.entryFile),
        subtitle: `${branch.entryFile}:${branch.entryLine}`,
        steps: branch.steps,
        hasBridge: branch.steps.some((s) => s.edgeKind === "bridge"),
        hasTerminal: branch.steps.some((s) => s.terminal)
      });
    }
    return out;
  }, [branches, mainSteps, result?.seed.relativePath, t]);

  const prunedBranches = useMemo(() => branches.filter((b) => b.pruned), [branches]);

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
      mainSteps.length,
      groups.length
    )
    : "";

  const toggleGroup = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  useEffect(() => {
    if (result?.requestId) {
      setExpandedIds(new Set(["primary"]));
      setPrunedOpen(false);
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
            {discardedCount > 0 ? (
              <p className="muted wb-linkgraph-hint">{t("desktop.workbench.linkGraphDiscarded", discardedCount)}</p>
            ) : null}
            {truncatedBranchCount > 0 ? (
              <p className="muted wb-linkgraph-hint">{t("desktop.workbench.linkGraphTruncated", truncatedBranchCount)}</p>
            ) : null}
            {bridgeStatus && bridgeStatus !== "skipped" ? (
              <p className="muted wb-linkgraph-hint">
                {t(`desktop.workbench.linkGraphBridge.${bridgeStatus}`)}
              </p>
            ) : null}
          </section>
        ) : null}

        {groups.length ? (
          <section className="wb-linkgraph-section">
            <h3 className="wb-linkgraph-section-title">
              {t("desktop.workbench.linkGraphChainGroups")} · {groups.length}
            </h3>
            <p className="muted wb-linkgraph-hint">{t("desktop.workbench.linkGraphChainGroupsHint")}</p>
            <div className="wb-linkgraph-groups">
              {groups.map((group) => {
                const open = expandedIds.has(group.id);
                return (
                  <div
                    key={group.id}
                    className={`wb-linkgraph-group${group.kind === "primary" ? " is-primary" : ""}${open ? " is-open" : ""}`}
                  >
                    <button
                      type="button"
                      className="wb-linkgraph-group-head"
                      aria-expanded={open}
                      onClick={() => toggleGroup(group.id)}
                    >
                      <ThemeIcon name="chevron-right" className={open ? "is-expanded" : ""} size={12} />
                      <span className="wb-linkgraph-group-title">{group.title}</span>
                      <span className="wb-linkgraph-group-meta muted">
                        {group.subtitle}
                        {" · "}
                        {t("desktop.workbench.linkGraphStepCount", group.steps.length)}
                      </span>
                      {group.hasBridge ? (
                        <span className="wb-linkgraph-bridge-badge">{t("desktop.workbench.linkGraphBadgeBridge")}</span>
                      ) : null}
                      {group.hasTerminal ? (
                        <span className="wb-linkgraph-terminal-badge">{t("desktop.workbench.linkGraphBadgeVo")}</span>
                      ) : null}
                    </button>
                    {open ? (
                      <ol className="wb-linkgraph-chain wb-linkgraph-group-steps">
                        {group.steps.map((step, index) => (
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
                );
              })}
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

        {prunedBranches.length ? (
          <section className="wb-linkgraph-section">
            <button
              type="button"
              className="wb-linkgraph-section-toggle"
              aria-expanded={prunedOpen}
              onClick={() => setPrunedOpen((v) => !v)}
            >
              <ThemeIcon name="chevron-right" className={prunedOpen ? "is-expanded" : ""} size={12} />
              <span className="wb-linkgraph-section-title muted">
                {t("desktop.workbench.linkGraphPrunedBranches")} · {prunedBranches.length}
              </span>
            </button>
            {prunedOpen ? (
              <>
                <p className="muted wb-linkgraph-hint">{t("desktop.workbench.linkGraphPrunedHint")}</p>
                <ul className="wb-linkgraph-branches is-pruned">
                  {prunedBranches.map((branch) => (
                    <li key={branch.id} className="wb-linkgraph-branch-entry muted">
                      {branch.entryFile}:{branch.entryLine}
                      {branch.pruneReason ? ` · ${branch.pruneReason}` : ""}
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </section>
        ) : null}

        {!busy && !error && !result ? (
          <p className="muted wb-linkgraph-empty">{t("desktop.workbench.linkGraphHint")}</p>
        ) : null}

        {!busy && result && !groups.length && !prunedBranches.length ? (
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
  for (const branch of result?.branches || []) {
    const step = branch.steps.find((s) => s.file === normalized && s.path);
    if (step) return step.path;
  }
  const sameFile = result?.hits.find(
    (hit) => hit.relativePath === normalized || hit.relativePath.endsWith(`/${normalized}`)
  );
  if (sameFile) return sameFile.path;
  return normalized;
}
