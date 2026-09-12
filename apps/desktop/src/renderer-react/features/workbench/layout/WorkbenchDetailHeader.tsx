import { ThemeIcon } from "../../../components/ThemeIcon";
import { useI18n } from "../../../i18n";
import type { TerminalPane } from "../terminal/TerminalView";

export type WorkbenchSideView = "files" | "git" | "search" | "scripts" | "linkgraph" | null;

export function WorkbenchDetailHeader({
  foldersCollapsed,
  onToggleFoldersCollapsed,
  selectedProject,
  projectLabel,
  side,
  branchStatusLabel,
  branchStatusPane,
  branchStatusNested,
  onOpenBranchMenu,
  onToggleSide
}: {
  foldersCollapsed: boolean;
  onToggleFoldersCollapsed: () => void;
  selectedProject: string | null;
  projectLabel: string;
  side: WorkbenchSideView;
  branchStatusLabel: string | null;
  branchStatusPane: TerminalPane | null;
  branchStatusNested: boolean;
  onOpenBranchMenu: (pane: TerminalPane, anchor: HTMLButtonElement) => void;
  onToggleSide: (view: Exclude<WorkbenchSideView, null>) => void;
}): React.JSX.Element {
  const { t } = useI18n();
  return <>
    <button
      type="button"
      className={`sidebar-collapse-toggle${foldersCollapsed ? " is-active" : ""}`}
      aria-label={t("desktop.workbench.resizeProjects")}
      onClick={onToggleFoldersCollapsed}
    ><ThemeIcon name="panel-right" size={17} /></button>
    <div className="wb-detail-head">
      <span className="wb-detail-project-label">
        <span className="wb-detail-project-label-text">{selectedProject ? projectLabel : t("desktop.workbench.allSessions")}</span>
        {selectedProject ? <span className="wb-detail-project-path">{selectedProject}</span> : null}
      </span>
      <div className="wb-detail-head-actions">
        {branchStatusLabel && branchStatusPane ? (
          <div className="wb-terminal-status">
            <button
              type="button"
              className="wb-terminal-status-branch"
              title={branchStatusNested
                ? branchStatusPane.nestedRepos?.map((repo) => `${repo.displayPath || repo.root}: ${repo.branch || "-"}`).join(", ")
                : branchStatusLabel}
              onClick={(event) => void onOpenBranchMenu(branchStatusPane, event.currentTarget)}
            >
              <ThemeIcon name="git-branch" size={12} aria-hidden="true" />
              <span className="wb-terminal-status-branch-label">{branchStatusLabel}</span>
            </button>
          </div>
        ) : null}
        <div className="wb-detail-tools">
          <button type="button" className={`wb-detail-tool${side === "files" ? " active" : ""}`} aria-pressed={side === "files"} aria-label={t("desktop.workbench.sidePanelExplorer")} title={t("desktop.workbench.sidePanelExplorer")} onClick={() => onToggleSide("files")}><ThemeIcon name="folder-tree" size={16} /></button>
          <button type="button" className={`wb-detail-tool${side === "scripts" ? " active" : ""}`} aria-pressed={side === "scripts"} aria-label={t("desktop.workbench.sidePanelScripts")} title={t("desktop.workbench.sidePanelScripts")} onClick={() => onToggleSide("scripts")}><ThemeIcon name="play" size={16} /></button>
          <button type="button" className={`wb-detail-tool${side === "search" ? " active" : ""}`} aria-pressed={side === "search"} aria-label={t("desktop.workbench.sidePanelSearch")} title={t("desktop.workbench.sidePanelSearch")} onClick={() => onToggleSide("search")}><ThemeIcon name="search" size={16} /></button>
          <button type="button" className={`wb-detail-tool${side === "linkgraph" ? " active" : ""}`} aria-pressed={side === "linkgraph"} aria-label={t("desktop.workbench.sidePanelLinkGraph")} title={t("desktop.workbench.sidePanelLinkGraph")} onClick={() => onToggleSide("linkgraph")}><ThemeIcon name="waypoints" size={16} /></button>
          <button type="button" className={`wb-detail-tool${side === "git" ? " active" : ""}`} aria-pressed={side === "git"} aria-label={t("desktop.workbench.sidePanelGit")} title={t("desktop.workbench.sidePanelGit")} onClick={() => onToggleSide("git")}><ThemeIcon name="git-branch" size={16} /></button>
        </div>
      </div>
    </div>
  </>;
}
