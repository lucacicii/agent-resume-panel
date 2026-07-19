import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, RefreshCw } from "lucide-react";
import { desktopApi } from "../../bridge";
import { Sheet } from "../../components/Sheet";
import { Status, type StatusKind } from "../../components/Status";
import { useI18n } from "../../i18n";

type PreviewResult = Awaited<ReturnType<ReturnType<typeof desktopApi>["previewReportGtdSync"]>>;
type Proposal = PreviewResult["proposals"][number];
type Scope = { level: string; reportId: string };
type DraftProposal = Proposal & { gtd: string; todolistMarkdown: string };
type CachedPreview = {
  items: DraftProposal[];
  warnings: string[];
  status: { text: string; kind?: StatusKind };
  allApplied: boolean;
};

const statuses = ["inbox", "next", "waiting", "someday", "reference"];

function toDraft(proposal: Proposal): DraftProposal {
  return { ...proposal, gtd: proposal.proposedGtd, tasks: [...proposal.tasks], todolistMarkdown: proposal.todolistPreview };
}

function cloneItems(items: DraftProposal[]): DraftProposal[] {
  return items.map((item) => ({ ...item, tasks: [...item.tasks], sourceReportIds: [...item.sourceReportIds] }));
}

function periodKey(scope: Scope): string {
  const prefix = `${scope.level}:`;
  return scope.reportId.startsWith(prefix) ? scope.reportId.slice(prefix.length) : scope.reportId;
}

export function GtdSheet(): React.JSX.Element | null {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<Scope | null>(null);
  const [items, setItems] = useState<DraftProposal[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [status, setStatus] = useState<{ text: string; kind?: StatusKind }>({ text: "" });
  const [applying, setApplying] = useState<string | null>(null);
  const [allApplied, setAllApplied] = useState(false);
  const [editorIndex, setEditorIndex] = useState<number | null>(null);
  const [editorValue, setEditorValue] = useState("");
  const cache = useRef(new Map<string, CachedPreview>());
  const state = useRef({ scope: null as Scope | null, items: [] as DraftProposal[], warnings: [] as string[], status: { text: "" } as { text: string; kind?: StatusKind }, allApplied: false });
  const previewRequest = useRef(0);

  useEffect(() => {
    state.current = { scope, items, warnings, status, allApplied };
  }, [allApplied, items, scope, status, warnings]);

  const snapshot = useCallback(() => {
    const current = state.current;
    if (!current.scope) return;
    cache.current.set(current.scope.reportId, {
      items: cloneItems(current.items),
      warnings: [...current.warnings],
      status: current.status,
      allApplied: current.allApplied
    });
  }, []);

  const preview = useCallback(async (nextScope: Scope, force = false) => {
    const request = ++previewRequest.current;
    if (!force) {
      const cached = cache.current.get(nextScope.reportId);
      if (cached) {
        state.current = { scope: nextScope, items: cloneItems(cached.items), warnings: [...cached.warnings], status: cached.status, allApplied: cached.allApplied };
        setItems(cloneItems(cached.items));
        setWarnings([...cached.warnings]);
        setStatus(cached.status);
        setAllApplied(cached.allApplied);
        return;
      }
    }
    const loadingStatus = { text: t("desktop.report.gtdAnalyzing", nextScope.level) };
    const isNewScope = state.current.scope?.reportId !== nextScope.reportId;
    state.current = { scope: nextScope, items: isNewScope ? [] : state.current.items, warnings: isNewScope ? [] : state.current.warnings, status: loadingStatus, allApplied: false };
    if (isNewScope) {
      setItems([]);
      setWarnings([]);
    }
    setAllApplied(false);
    setStatus(loadingStatus);
    try {
      const result = await desktopApi().previewReportGtdSync({ ensureDigests: false, reportIds: [nextScope.reportId] });
      const nextItems = result.proposals.map(toDraft);
      const nextStatus = {
        text: t("desktop.report.gtdPreviewStatus", nextItems.length, nextScope.level, periodKey(nextScope), t("desktop.report.gtdNotSaved")),
        kind: nextItems.length ? "ok" as const : "error" as const
      };
      cache.current.set(nextScope.reportId, { items: cloneItems(nextItems), warnings: [...result.warnings], status: nextStatus, allApplied: false });
      if (request !== previewRequest.current) return;
      state.current = { scope: nextScope, items: nextItems, warnings: result.warnings, status: nextStatus, allApplied: false };
      setItems(nextItems);
      setWarnings(result.warnings);
      setStatus(nextStatus);
    } catch (error) {
      if (request !== previewRequest.current) return;
      state.current = { scope: nextScope, items: [], warnings: [], status: { text: error instanceof Error ? error.message : String(error), kind: "error" }, allApplied: false };
      setItems([]);
      setWarnings([]);
      setAllApplied(false);
      setStatus({ text: error instanceof Error ? error.message : String(error), kind: "error" });
    }
  }, [t]);

  useEffect(() => {
    const onOpen = (event: Event) => {
      const detail = event instanceof CustomEvent ? event.detail as Scope : null;
      if (!detail?.reportId) return;
      snapshot();
      setScope(detail);
      setOpen(true);
      void preview(detail);
    };
    window.addEventListener("agent-resume:gtd-open", onOpen);
    return () => {
      window.removeEventListener("agent-resume:gtd-open", onOpen);
    };
  }, [preview, snapshot]);

  const update = (index: number, patch: Partial<DraftProposal>) => {
    setItems((current) => {
      const next = current.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item);
      if (scope) cache.current.set(scope.reportId, { items: cloneItems(next), warnings: [...warnings], status, allApplied: false });
      state.current = { ...state.current, items: next, allApplied: false };
      return next;
    });
    setAllApplied(false);
  };

  const apply = async (index: number) => {
    const item = items[index];
    if (!item) return;
    setApplying(`${item.provider}:${item.sessionId}`);
    setStatus({ text: t("desktop.report.gtdAddingItem", item.title || item.sessionId) });
    try {
      const result = await desktopApi().applyReportGtdSync({ items: [{
        provider: item.provider,
        sessionId: item.sessionId,
        gtd: item.gtd,
        reason: item.reason,
        tasks: item.tasks,
        sourceReportIds: item.sourceReportIds,
        title: item.title,
        projectPath: item.projectPath,
        previousGtd: item.previousGtd,
        todolistMarkdown: item.todolistMarkdown
      }] });
      if (!result.applied.length) {
        setStatus({ text: result.failed[0]?.error || t("desktop.report.gtdAddFailed"), kind: "error" });
        return;
      }
      const path = result.applied[0]?.todolistPath || "";
      const nextStatus = { text: t("desktop.report.gtdApplied", item.title || item.sessionId, path ? ` · ${path}` : ""), kind: "ok" as const };
      setItems((current) => {
        const next = current.filter((_, itemIndex) => itemIndex !== index);
        if (scope) cache.current.set(scope.reportId, { items: cloneItems(next), warnings: [...warnings], status: nextStatus, allApplied: next.length === 0 });
        state.current = { ...state.current, items: next, status: nextStatus, allApplied: next.length === 0 };
        return next;
      });
      setAllApplied(items.length === 1);
      setStatus(nextStatus);
    } catch (error) {
      setStatus({ text: error instanceof Error ? error.message : String(error), kind: "error" });
    } finally {
      setApplying(null);
    }
  };

  const close = () => {
    snapshot();
    setEditorIndex(null);
    setOpen(false);
  };

  if (!scope) return null;
  return <Sheet open={open} title={t("desktop.sheet.gtdTitle")} onClose={close} wide bodyClassName="gtd-sheet">
    <p className="muted gtd-sheet-description">{t("desktop.sheet.gtdDesc")}</p>
    <div className="gtd-sheet-toolbar">
      <button type="button" className="tool-btn" onClick={() => void preview(scope, true)}><RefreshCw size={15} /> {t("desktop.report.gtdReanalyze")}</button>
    </div>
    {warnings.length ? <ul className="gtd-empty-warnings">{warnings.map((warning, index) => <li key={`${warning}:${index}`}>{warning}</li>)}</ul> : null}
    {!items.length ? <div className="muted gtd-empty"><p>{allApplied ? t("desktop.report.gtdAllApplied") : t("desktop.report.gtdNoProposals")}</p>{!allApplied ? <><p>{t("desktop.report.gtdNoSessionsReason")}</p><p>{t("desktop.report.gtdWarnDefault")}</p></> : null}</div> : <div className="gtd-preview">
      {items.map((item, index) => <GtdItem key={`${item.provider}:${item.sessionId}`} item={item} applying={applying === `${item.provider}:${item.sessionId}`} t={t} onChange={(patch) => update(index, patch)} onApply={() => void apply(index)} onOpenMarkdown={() => { setEditorIndex(index); setEditorValue(item.todolistMarkdown); }} />)}
    </div>}
    <Status kind={status.kind}>{status.text}</Status>
    {editorIndex !== null ? <div className="gtd-md-overlay" role="presentation">
      <button type="button" className="gtd-md-overlay-backdrop" aria-label={t("desktop.common.close")} onClick={() => { update(editorIndex, { todolistMarkdown: editorValue }); setEditorIndex(null); }} />
      <section className="gtd-md-overlay-panel" role="dialog" aria-modal="true" aria-label={t("desktop.report.gtdMdDialog")}>
        <header className="gtd-md-overlay-head"><strong>todolist.md</strong><span className="muted gtd-md-overlay-hint">{t("desktop.report.gtdMdHint")}</span><button type="button" className="tool-btn" onClick={() => { update(editorIndex, { todolistMarkdown: editorValue }); setEditorIndex(null); }}>{t("desktop.report.gtdMdDone")}</button></header>
        <textarea className="gtd-md-overlay-ta" aria-label={t("desktop.report.gtdMdDialog")} spellCheck={false} autoFocus value={editorValue} onChange={(event) => setEditorValue(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); update(editorIndex, { todolistMarkdown: editorValue }); setEditorIndex(null); } }} />
      </section>
    </div> : null}
  </Sheet>;
}

function GtdItem({ item, applying, t, onChange, onApply, onOpenMarkdown }: {
  item: DraftProposal;
  applying: boolean;
  t: (key: string, ...args: Array<string | number>) => string;
  onChange: (patch: Partial<DraftProposal>) => void;
  onApply: () => void;
  onOpenMarkdown: () => void;
}): React.JSX.Element {
  const [collapsed, setCollapsed] = useState(false);
  const previous = item.previousGtd ? `@${item.previousGtd}` : t("desktop.report.gtdWasNone");
  return <article className={`gtd-row${collapsed ? " collapsed" : ""}`}>
    <div className="gtd-row-head">
      <button type="button" className="gtd-row-toggle" aria-label={t("desktop.report.gtdCollapseTitle")} onClick={() => setCollapsed((value) => !value)}>{collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}</button>
      <div className="gtd-row-title"><strong>{item.title || item.sessionId}</strong><div className="meta">{item.provider} · {item.sessionId.slice(0, 18)} · {t("desktop.report.gtdWasLabel", previous)}</div></div>
      <button type="button" className="tool-btn gtd-add-btn" disabled={applying} onClick={onApply}>{applying ? t("desktop.report.gtdAdding") : t("desktop.report.gtdAddBtn")}</button>
    </div>
    {!collapsed ? <div className="gtd-edit-grid">
      <label>{t("desktop.report.gtdStatusLabel")}<select value={item.gtd} onChange={(event) => onChange({ gtd: event.target.value })}>{statuses.map((status) => <option value={status} key={status}>@{status}</option>)}</select></label>
      <label>{t("desktop.report.gtdReasonLabel")}<textarea rows={2} value={item.reason} onChange={(event) => onChange({ reason: event.target.value })} /></label>
      <label>{t("desktop.report.gtdTasksLabel")}<textarea rows={3} value={item.tasks.join("\n")} onChange={(event) => onChange({ tasks: event.target.value.split("\n").map((value) => value.trim()).filter(Boolean) })} /></label>
      <label>{t("desktop.report.gtdTodoLabel")}<textarea className="gtd-md md" rows={8} title={t("desktop.report.gtdFocusEditor")} value={item.todolistMarkdown} onFocus={onOpenMarkdown} onChange={(event) => onChange({ todolistMarkdown: event.target.value })} /></label>
    </div> : null}
  </article>;
}
