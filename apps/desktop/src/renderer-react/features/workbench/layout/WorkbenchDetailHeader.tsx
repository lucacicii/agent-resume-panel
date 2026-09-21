import { ICON_SIZE, ThemeIcon } from "../../../components/ThemeIcon";
import { useI18n } from "../../../i18n";
import type { TerminalPane } from "../terminal/TerminalView";

type WorkbenchSideView = "files" | "git" | "search" | "scripts" | null;

export function WorkbenchDetailHeader({
  title,
  directory,
  onRevealDirectory,
  imageUrl,
  side,
  branchStatusLabel,
  branchStatusPane,
  branchStatusNested,
  onOpenBranchMenu,
  onToggleSide,
  centerContent,
  gitDirtyCount = 0
}: {
  /** What the header names: the task, or a bare project selection. */
  title: string;
  /** Absolute directory the header points at, or null when there is none. */
  directory: string | null;
  /** Reveal `directory` in Finder; omitted when it cannot be shown. */
  onRevealDirectory?: () => void;
  /** The scoped task's template image; absent when the task has none. */
  imageUrl?: string | null;
  side: WorkbenchSideView;
  branchStatusLabel: string | null;
  branchStatusPane: TerminalPane | null;
  branchStatusNested: boolean;
  onOpenBranchMenu: (pane: TerminalPane, anchor: HTMLButtonElement) => void;
  onToggleSide: (view: Exclude<WorkbenchSideView, null>) => void;
  /** Optional center content, e.g. task workbench tabs. */
  centerContent?: React.ReactNode;
  /** Total staged + unstaged changes in the active git repository. */
  gitDirtyCount?: number;
}): React.JSX.Element {
  const { t } = useI18n();
  // Accelerators are surfaced in tooltips so the keyboard path is discoverable
  // where the control lives, not only in the menu bar.
  const isMac = typeof navigator !== "undefined" && /mac/i.test(navigator.platform);
  const shiftAccel = (key: string, meta: boolean) =>
    isMac ? `${meta ? "⌘" : "⌃"}⇧${key}` : `Ctrl+Shift+${key}`;
  const gitAccel = shiftAccel("G", false);
  const searchAccel = shiftAccel("F", true);
  const gitLabel = gitDirtyCount > 0
    ? `${t("desktop.workbench.sidePanelGit")}, ${gitDirtyCount}`
    : t("desktop.workbench.sidePanelGit");
  return <>
    <div className="wb-detail-head">
      <span className="wb-detail-project-label">
        {imageUrl ? <img className="wb-detail-task-image" src={imageUrl} alt="" aria-hidden="true" /> : null}
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
      {centerContent ? <div className="wb-detail-head-center">{centerContent}</div> : null}
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
          <button
            type="button"
            className={`wb-detail-tool${side === "git" ? " active" : ""}${gitDirtyCount > 0 ? " has-changes" : ""}`}
            aria-pressed={side === "git"}
            aria-label={gitLabel}
            title={`${gitLabel} (${gitAccel})`}
            onClick={() => onToggleSide("git")}
          >
            <ThemeIcon name="git-branch" size={ICON_SIZE.default} />
            {gitDirtyCount > 0 ? (
              <span className="wb-detail-tool-badge" aria-hidden="true">
                {gitDirtyCount > 99 ? "99+" : gitDirtyCount}
              </span>
            ) : null}
          </button>
          <button
            type="button"
            className={`wb-detail-tool${side === "files" ? " active" : ""}`}
            aria-pressed={side === "files"}
            aria-label={t("desktop.workbench.sidePanelExplorer")}
            title={t("desktop.workbench.sidePanelExplorer")}
            onClick={() => onToggleSide("files")}
          >
            <ThemeIcon name="folder-tree" size={ICON_SIZE.default} />
          </button>
          <button
            type="button"
            className={`wb-detail-tool${side === "search" ? " active" : ""}`}
            aria-pressed={side === "search"}
            aria-label={t("desktop.workbench.sidePanelSearch")}
            title={`${t("desktop.workbench.sidePanelSearch")} (${searchAccel})`}
            onClick={() => onToggleSide("search")}
          >
            <ThemeIcon name="search" size={ICON_SIZE.default} />
          </button>
          <button
            type="button"
            className={`wb-detail-tool${side === "scripts" ? " active" : ""}`}
            aria-pressed={side === "scripts"}
            aria-label={t("desktop.workbench.sidePanelScripts")}
            title={t("desktop.workbench.sidePanelScripts")}
            onClick={() => onToggleSide("scripts")}
          >
            <ThemeIcon name="play" size={ICON_SIZE.default} />
          </button>
        </div>
      </div>
    </div>
  </>;
}
