import { useCallback, useEffect, useState } from "react";
import { ICON_SIZE, ThemeIcon } from "../../../components/ThemeIcon";
import { useI18n } from "../../../i18n";
import { showContextMenuAt, type NativeContextMenuItem } from "../../../nativeContextMenu";
import { desktopApi } from "../../../bridge";

/** Where the project header button sends a directory. */
export type DirectoryOpenTarget = "zed" | "vscode" | "finder";

const OPEN_TARGET_STORAGE_KEY = "workbench-open-directory-in";
const OPEN_TARGETS: DirectoryOpenTarget[] = ["zed", "vscode", "finder"];

function readOpenTarget(): DirectoryOpenTarget {
  try {
    const stored = localStorage.getItem(OPEN_TARGET_STORAGE_KEY);
    return OPEN_TARGETS.includes(stored as DirectoryOpenTarget) ? (stored as DirectoryOpenTarget) : "zed";
  } catch {
    return "zed";
  }
}

type WorkbenchSideView = "scripts" | "browser" | null;

/**
 * The project header's "open this directory" control.
 *
 * Clicking it runs the remembered target — Zed by default — and the caret opens
 * the menu that changes it, so the common case is one click and choosing another
 * app never requires going through settings.
 */
function DirectoryOpenControl({
  directory,
  onOpenDirectory
}: {
  directory: string;
  onOpenDirectory: (target: DirectoryOpenTarget) => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const [target, setTarget] = useState<DirectoryOpenTarget>(readOpenTarget);
  const [icons, setIcons] = useState<Partial<Record<DirectoryOpenTarget, string>>>({});

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const loaded = await desktopApi().workbenchAppIcons({ apps: OPEN_TARGETS });
        // A bridge that predates this call resolves nothing: the control must
        // still render, with its own glyph.
        if (!cancelled) setIcons((loaded ?? {}) as Partial<Record<DirectoryOpenTarget, string>>);
      } catch {
        // no icons: the button keeps its own glyph
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const labelFor = useCallback(
    (value: DirectoryOpenTarget) => t(`desktop.workbench.openDirectoryIn.${value}`),
    [t]
  );

  const choose = useCallback(
    async (anchor: HTMLElement) => {
      const rect = anchor.getBoundingClientRect();
      const items: NativeContextMenuItem[] = OPEN_TARGETS.map((value) => ({
        id: value,
        label: labelFor(value),
        type: value === target ? "checkbox" : undefined,
        checked: value === target,
        ...(icons[value] ? { icon: icons[value] } : {})
      }));
      const chosen = await showContextMenuAt({ x: rect.left, y: rect.bottom + 4 }, items);
      if (!chosen || !OPEN_TARGETS.includes(chosen as DirectoryOpenTarget)) return;
      const next = chosen as DirectoryOpenTarget;
      setTarget(next);
      try {
        localStorage.setItem(OPEN_TARGET_STORAGE_KEY, next);
      } catch {
        // remembering the choice is optional
      }
      onOpenDirectory(next);
    },
    [icons, labelFor, onOpenDirectory, target]
  );

  return (
    <span className="wb-detail-project-open">
      <button
        type="button"
        className="wb-detail-project-reveal"
        aria-label={labelFor(target)}
        title={`${labelFor(target)}\n${directory}`}
        onClick={() => onOpenDirectory(target)}
        onContextMenu={(event) => {
          event.preventDefault();
          void choose(event.currentTarget);
        }}
      >
        {icons[target] ? (
          <img className="wb-detail-project-app-icon" src={icons[target]} alt="" aria-hidden="true" />
        ) : (
          <ThemeIcon name="folder-open" size={ICON_SIZE.dense} aria-hidden="true" />
        )}
      </button>
      <button
        type="button"
        className="wb-detail-project-reveal-caret"
        aria-label={t("desktop.workbench.openDirectoryWith")}
        aria-haspopup="menu"
        title={t("desktop.workbench.openDirectoryWith")}
        onClick={(event) => void choose(event.currentTarget)}
      >
        <ThemeIcon name="chevron-down" size={ICON_SIZE.inline} aria-hidden="true" />
      </button>
    </span>
  );
}

export function WorkbenchDetailHeader({
  title,
  directory,
  onOpenDirectory,
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
  /** Send `directory` to an editor or the Finder; omitted when it cannot be shown. */
  onOpenDirectory?: (target: DirectoryOpenTarget) => void;
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
        {directory && onOpenDirectory ? (
          <DirectoryOpenControl directory={directory} onOpenDirectory={onOpenDirectory} />
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
