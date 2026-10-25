import { ICON_SIZE, ThemeIcon } from "../../../components/ThemeIcon";
import { useI18n } from "../../../i18n";

type WorkbenchSideView = "scripts" | "browser" | null;

export function WorkbenchDetailHeader({
  title,
  directory,
  onRevealDirectory,
  imageUrl,
  side,
  onToggleSide,
  centerContent,
  directoryWorktree = null
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
  onToggleSide: (view: Exclude<WorkbenchSideView, null>) => void;
  /** Optional center content, e.g. task workbench tabs. */
  centerContent?: React.ReactNode;
  /** Total staged + unstaged changes in the active git repository. */
  /**
   * The branch of the worktree `directory` points at, when it is one. The path
   * alone would read as an unrelated folder, so the header names the checkout.
   */
  directoryWorktree?: { branch: string; path: string } | null;
  /** The branch of the worktree the active terminal runs in, when it is one. */
}): React.JSX.Element {
  const { t } = useI18n();
  // Accelerators are surfaced in tooltips so the keyboard path is discoverable
  // where the control lives, not only in the menu bar.
  const isMac = typeof navigator !== "undefined" && /mac/i.test(navigator.platform);
  return <>
    <div className="wb-detail-head">
      <span className="wb-detail-project-label">
        {imageUrl ? <img className="wb-detail-task-image" src={imageUrl} alt="" aria-hidden="true" /> : null}
        <span className="wb-detail-project-label-text">{title}</span>
        {directory ? <span className="wb-detail-project-path">{directory}</span> : null}
        {directoryWorktree ? (
          <span className="wb-detail-project-path-worktree" title={directoryWorktree.path}>⌥ {directoryWorktree.branch}</span>
        ) : null}
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
        <div className="wb-detail-tools">
          
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
          <button
            type="button"
            className={`wb-detail-tool${side === "browser" ? " active" : ""}`}
            aria-pressed={side === "browser"}
            aria-label={t("desktop.workbench.sidePanelBrowser")}
            title={t("desktop.workbench.sidePanelBrowser")}
            onClick={() => onToggleSide("browser")}
          >
            <ThemeIcon name="globe" size={ICON_SIZE.default} />
          </button>
        </div>
      </div>
    </div>
  </>;
}
