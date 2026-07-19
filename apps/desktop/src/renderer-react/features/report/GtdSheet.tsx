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

const statuses = ["inbox", "next", "waiting", "someday", "reference"];

function toDraft(proposal: Proposal): DraftProposal {
  return { ...proposal, gtd: proposal.proposedGtd, tasks: [...proposal.tasks], todolistMarkdown: proposal.todolistPreview };
}

export function GtdSheet(): React.JSX.Element | null {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<Scope | null>(null);
  const [items, setItems] = useState<DraftProposal[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [status, setStatus] = useState<{ text: string; kind?: StatusKind }>({ text: "" });
  const [applying, setApplying] = useState<string | null>(null);
  const cache = useRef(new Map<string, {
    items: DraftProposal[];
    warnings: string[];
    status: { text: string; kind?: StatusKind };
  }>());

  const preview = useCallback(async (nextScope: Scope, force = false) => {
    if (!force) {
      const cached = cache.current.get(nextScope.reportId);
      if (cached) {
        setItems(cached.items);
        setWarnings(cached.warnings);
        setStatus(cached.status);
        return;
      }
    }
    setStatus({ text: t("desktop.report.gtdAnalyzing", nextScope.level) });
    try {
      const result = await desktopApi().previewReportGtdSync({ ensureDigests: false, reportIds: [nextScope.reportId] });
      const nextItems = result.proposals.map(toDraft);
      const nextStatus = {
        text: t("desktop.report.gtdPreviewStatus", nextItems.length, nextScope.level, nextScope.reportId, t("desktop.report.gtdNotSaved")),
        kind: nextItems.length ? "ok" as const : "error" as const
      };
      cache.current.set(nextScope.reportId, { items: nextItems, warnings: result.warnings, status: nextStatus });
      setItems(nextItems);
      setWarnings(result.warnings);
      setStatus(nextStatus);
    } catch (error) {
      setItems([]);
      setWarnings([]);
      setStatus({ text: error instanceof Error ? error.message : String(error), kind: "error" });
    }
  }, [t]);

  useEffect(() => {
    const onOpen = (event: Event) => {
      const detail = event instanceof CustomEvent ? event.detail as Scope : null;
      if (!detail?.reportId) return;
      setScope(detail);
      setOpen(true);
      void preview(detail);
    };
    window.addEventListener("agent-resume:gtd-open", onOpen);
    return () => {
      window.removeEventListener("agent-resume:gtd-open", onOpen);
    };
  }, [preview]);

  const update = (index: number, patch: Partial<DraftProposal>) => {
    setItems((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
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
      setItems((current) => current.filter((_, itemIndex) => itemIndex !== index));
      const nextStatus = { text: t("desktop.report.gtdApplied", item.title || item.sessionId, path ? ` · ${path}` : ""), kind: "ok" as const };
      setStatus(nextStatus);
      if (scope) cache.current.set(scope.reportId, { items: items.filter((_, itemIndex) => itemIndex !== index), warnings, status: nextStatus });
    } catch (error) {
      setStatus({ text: error instanceof Error ? error.message : String(error), kind: "error" });
    } finally {
      setApplying(null);
    }
  };

  if (!scope) return null;
  return <Sheet open={open} title={t("desktop.report.gtdTitle")} onClose={() => setOpen(false)} wide bodyClassName="gtd-sheet">
    <div className="gtd-sheet-toolbar">
      <button type="button" className="tool-btn" onClick={() => void preview(scope, true)}><RefreshCw size={15} /> {t("desktop.report.gtdReanalyze")}</button>
    </div>
    {warnings.length ? <ul className="gtd-empty-warnings">{warnings.map((warning, index) => <li key={`${warning}:${index}`}>{warning}</li>)}</ul> : null}
    {!items.length ? <div className="muted gtd-empty"><p>{t("desktop.report.gtdNoProposals")}</p><p>{t("desktop.report.gtdNoSessionsReason")}</p></div> : <div className="gtd-preview">
      {items.map((item, index) => <GtdItem key={`${item.provider}:${item.sessionId}`} item={item} applying={applying === `${item.provider}:${item.sessionId}`} t={t} onChange={(patch) => update(index, patch)} onApply={() => void apply(index)} />)}
    </div>}
    <Status kind={status.kind}>{status.text}</Status>
  </Sheet>;
}

function GtdItem({ item, applying, t, onChange, onApply }: {
  item: DraftProposal;
  applying: boolean;
  t: (key: string, ...args: Array<string | number>) => string;
  onChange: (patch: Partial<DraftProposal>) => void;
  onApply: () => void;
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
      <label>{t("desktop.report.gtdTodoLabel")}<textarea className="gtd-md md" rows={8} value={item.todolistMarkdown} onChange={(event) => onChange({ todolistMarkdown: event.target.value })} /></label>
    </div> : null}
  </article>;
}
