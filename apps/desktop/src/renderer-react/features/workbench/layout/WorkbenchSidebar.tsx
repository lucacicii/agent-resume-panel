import type { GtdStatus } from "@agent-resume/core";
import { ThemeIcon } from "../../../components/ThemeIcon";
import { sessionDotStatusClass } from "../../../components/SessionDotsCluster";
import { useI18n } from "../../../i18n";
import type { ActiveSessionDot } from "../activeSessionDots";
import { needsYou, rollupDot } from "../sessionStatus/workItemRollup";
import type { WorkbenchWorkItem } from "../workItem";

const GTD_FILTER_STATUSES = ["inbox", "next", "waiting", "someday", "reference", "done"] as const satisfies readonly GtdStatus[];

export function WorkbenchSidebar({
  collapsed,
  workItems,
  selectedWorkItemId,
  workItemProjects,
  workItemProjectFilter,
  workItemStatusFilter,
  needsYouCount,
  workItemNeedsYouFilter,
  onWorkItemNeedsYouFilterChange,
  dotByKey,
  projectQuery,
  onProjectQueryChange,
  onAddWorkItem,
  onSelectWorkItem,
  onWorkItemProjectFilterChange,
  onWorkItemStatusFilterChange
}: {
  collapsed: boolean;
  workItems: WorkbenchWorkItem[];
  selectedWorkItemId: string | null;
  /** Distinct directories referenced by the work items, for the dimension filter. */
  workItemProjects: Array<{ path: string; label: string }>;
  workItemProjectFilter: string;
  workItemStatusFilter: "all" | GtdStatus;
  needsYouCount?: number;
  workItemNeedsYouFilter?: boolean;
  onWorkItemNeedsYouFilterChange?: (active: boolean) => void;
  dotByKey?: Map<string, ActiveSessionDot>;
  projectQuery: string;
  onProjectQueryChange: (value: string) => void;
  onAddWorkItem?: () => void;
  onSelectWorkItem: (item: WorkbenchWorkItem) => void;
  onWorkItemProjectFilterChange: (path: string) => void;
  onWorkItemStatusFilterChange: (status: "all" | GtdStatus) => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const effectiveNeedsYouCount = typeof needsYouCount === "number"
    ? needsYouCount
    : (dotByKey
      ? workItems.filter((item) => needsYou(rollupDot({ work: { sessions: item.sessions } }, dotByKey))).length
      : 0);
  return <aside className={`sidebar-folders-pane wb-folders-pane${collapsed ? " is-collapsed" : ""}`}>
    <div className="sidebar-project-filter-wrap">
      <div className="sidebar-project-search-wrap"><input type="search" className="sidebar-project-search" aria-label={t("desktop.workbench.filterWorkItems")} placeholder={t("desktop.workbench.filterWorkItems")} value={projectQuery} autoComplete="off" spellCheck={false} onChange={(event) => onProjectQueryChange(event.target.value)} /></div>
    </div>
    <div className="wb-folders">
      <div className="wb-folder-section wb-work-item-section">
        <div className="wb-folder-section-head">
          <div className="wb-folder-section-label">{t("desktop.workbench.workItemsView")}</div>
          <button
            type="button"
            className="wb-icon-btn wb-add-work-item-btn"
            aria-label={t("desktop.workbench.newWorkItem")}
            title={t("desktop.workbench.newWorkItem")}
            onClick={onAddWorkItem}
          >
            <ThemeIcon name="plus" size={14} />
          </button>
        </div>
        <div className="wb-work-item-filters">
          <select className="quiet-select wb-work-item-filter" aria-label={t("desktop.notes.projectLabel")} value={workItemProjectFilter} onChange={(event) => onWorkItemProjectFilterChange(event.target.value)}>
            <option value="">{t("desktop.common.all")}</option>
            {workItemProjects.map((project) => <option key={project.path} value={project.path}>{project.label}</option>)}
          </select>
          <select className="quiet-select wb-work-item-filter" aria-label={t("desktop.workbench.sessionFilter")} value={workItemStatusFilter} onChange={(event) => onWorkItemStatusFilterChange(event.target.value as "all" | GtdStatus)}>
            <option value="all">{t("desktop.common.all")}</option>
            {GTD_FILTER_STATUSES.map((status) => <option key={status} value={status}>{t(`desktop.workbench.gtdStatus.${status}`)}</option>)}
          </select>
          {effectiveNeedsYouCount > 0 ? (
            <button
              type="button"
              className={`wb-work-item-needs-chip${workItemNeedsYouFilter ? " is-active" : ""}`}
              aria-pressed={Boolean(workItemNeedsYouFilter)}
              onClick={() => onWorkItemNeedsYouFilterChange?.(!workItemNeedsYouFilter)}
            >
              <span className="session-dot is-awaiting" aria-hidden="true" />
              <span>{t("desktop.workbench.needsMe", effectiveNeedsYouCount)}</span>
            </button>
          ) : null}
        </div>
        {workItems.length ? workItems.map((item) => {
          const dot = dotByKey ? rollupDot({ work: { sessions: item.sessions } }, dotByKey) : undefined;
          return <button key={item.noteId} type="button" className={`wb-folder-row wb-work-item-row${selectedWorkItemId === item.noteId ? " active" : ""}`} onClick={() => onSelectWorkItem(item)} title={item.title}><span className={`wb-gtd-status-dot is-${item.status}`} aria-hidden="true" />{dot && dot.status !== "open" ? <span className={`session-dot${sessionDotStatusClass(dot.status)}`} aria-hidden="true" /> : null}<span className="wb-folder-row-text"><span className="wb-folder-row-label">{item.title}</span>{(item.projects?.length ?? 0) > 0 ? <span className="wb-folder-row-desc">{item.projects!.map((projectPath) => projectPath.split(/[\\/]/).filter(Boolean).at(-1) || projectPath).join(" · ")}</span> : null}</span><span className="wb-folder-row-count">{item.sessions.length}</span></button>;
        }) : <p className="muted wb-folders-empty">{t("desktop.workbench.noWorkItems")}</p>}
      </div>
    </div>
  </aside>;
}
