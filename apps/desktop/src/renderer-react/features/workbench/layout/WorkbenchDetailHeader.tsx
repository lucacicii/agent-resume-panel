import { ICON_SIZE, ThemeIcon } from "../../../components/ThemeIcon";
import { useI18n } from "../../../i18n";
import type { TerminalPane } from "../terminal/TerminalView";

type WorkbenchSideView = "files" | "git" | "search" | "scripts" | "linkgraph" | null;

export function WorkbenchDetailHeader({
  onBackToGtd,
  title,
  directory,
  onRevealDirectory,
  side,
  branchStatusLabel,
  branchStatusPane,
  branchStatusNested,
  onOpenBranchMenu,
  onToggleSide
}: {
  /** Return to the GTD board (the app's root view). */
  onBackToGtd?: () => void;
  /** What the header names: the task, or a bare project selection. */
  title: string;
  /** Absolute directory the header points at, or null when there is none. */
  directory: string | null;
  /** Reveal `directory` in Finder; omitted when it cannot be shown. */
  onRevealDirectory?: () => void;
  side: WorkbenchSideView;
  branchStatusLabel: string | null;
  branchStatusPane: TerminalPane | null;
  branchStatusNested: boolean;
  onOpenBranchMenu: (pane: TerminalPane, anchor: HTMLButtonElement) => void;
  onToggleSide: (view: Exclude<WorkbenchSideView, null>) => void;
}): React.JSX.Element {
  const { t } = useI18n();
  return <>
    {onBackToGtd ? (
      <button
        type="button"
        className="wb-back-to-gtd"
        aria-label={t("desktop.gtd.backToGtd")}
        title={t("desktop.gtd.backToGtd")}
        onClick={onBackToGtd}
      ><ThemeIcon name="arrow-left" size={ICON_SIZE.default} /></button>
    ) : null}
    <div className="wb-detail-head">
      <span className="wb-detail-project-label">
        <span className="wb-detail-project-label-text">{title}</span>
        {directory ? <span className="wb-detail-project-path">{directory}</span> : null}
        {directory && onRevealDirectory ? (
          <button
            type="button"
            className="wb-detail-project-reveal"
            aria-label={t("desktop.common.revealInFinder")}
            title={t("desktop.common.revealInFinder")}
            onClick={onRevealDirectory}
          ><ThemeIcon name="folder-open" size={ICON_SIZE.dense} aria-hidden="true" /></button>
        ) : null}
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
              <ThemeIcon name="git-branch" size={ICON_SIZE.inline} aria-hidden="true" />
              <span className="wb-terminal-status-branch-label">{branchStatusLabel}</span>
            </button>
          </div>
        ) : null}
        <div className="wb-detail-tools">
          <button type="button" className={`wb-detail-tool${side === "files" ? " active" : ""}`} aria-pressed={side === "files"} aria-label={t("desktop.workbench.sidePanelExplorer")} title={t("desktop.workbench.sidePanelExplorer")} onClick={() => onToggleSide("files")}><ThemeIcon name="folder-tree" size={ICON_SIZE.default} /></button>
          <button type="button" className={`wb-detail-tool${side === "scripts" ? " active" : ""}`} aria-pressed={side === "scripts"} aria-label={t("desktop.workbench.sidePanelScripts")} title={t("desktop.workbench.sidePanelScripts")} onClick={() => onToggleSide("scripts")}><ThemeIcon name="play" size={ICON_SIZE.default} /></button>
          <button type="button" className={`wb-detail-tool${side === "search" ? " active" : ""}`} aria-pressed={side === "search"} aria-label={t("desktop.workbench.sidePanelSearch")} title={t("desktop.workbench.sidePanelSearch")} onClick={() => onToggleSide("search")}><ThemeIcon name="search" size={ICON_SIZE.default} /></button>
          <button type="button" className={`wb-detail-tool${side === "linkgraph" ? " active" : ""}`} aria-pressed={side === "linkgraph"} aria-label={t("desktop.workbench.sidePanelLinkGraph")} title={t("desktop.workbench.sidePanelLinkGraph")} onClick={() => onToggleSide("linkgraph")}><ThemeIcon name="waypoints" size={ICON_SIZE.default} /></button>
          <button type="button" className={`wb-detail-tool${side === "git" ? " active" : ""}`} aria-pressed={side === "git"} aria-label={t("desktop.workbench.sidePanelGit")} title={t("desktop.workbench.sidePanelGit")} onClick={() => onToggleSide("git")}><ThemeIcon name="git-branch" size={ICON_SIZE.default} /></button>
        </div>
      </div>
    </div>
  </>;
}
