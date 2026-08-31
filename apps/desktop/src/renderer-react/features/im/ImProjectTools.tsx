import { ThemeIcon } from "../../components/ThemeIcon";
import { ResizeHandle } from "../../components/ResizeHandle";
import { notifyDesktop } from "../../components/Notifications";
import { desktopApi } from "../../bridge";
import { useI18n } from "../../i18n";
import { storedWidth } from "../../storage";
import { WorkbenchFileExplorer } from "../workbench/WorkbenchFileExplorer";
import { useCallback, useEffect, useState, type ReactNode } from "react";

const SIDE_WIDTH_KEY = "im-project-tools-width";

function statusError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useImProjectTools(rootPath: string | null): {
  toolbar: ReactNode;
  pane: ReactNode;
} {
  const { t } = useI18n();
  const [explorerOpen, setExplorerOpen] = useState(false);
  const [sideWidth, setSideWidth] = useState(() => storedWidth(SIDE_WIDTH_KEY, 280, 220, 520));
  const [branchLabel, setBranchLabel] = useState<string | null>(null);

  const hasRoot = Boolean(rootPath);
  const toolsDisabled = !hasRoot;
  const disabledTitle = t("desktop.im.associateFolderFirst");

  const openPath = useCallback(async (filePath: string) => {
    if (!rootPath) return;
    try {
      await desktopApi().workbenchOpenPath({ rootPath, filePath });
    } catch (error) {
      notifyDesktop({ text: statusError(error), kind: "error" });
    }
  }, [rootPath]);

  const refreshBranch = useCallback(async () => {
    if (!rootPath) {
      setBranchLabel(null);
      return;
    }
    try {
      const result = await desktopApi().terminalGitStatus({ cwd: rootPath });
      setBranchLabel(result.tracking?.[0]?.branch || null);
    } catch {
      setBranchLabel(null);
    }
  }, [rootPath]);

  useEffect(() => {
    setExplorerOpen(false);
    setBranchLabel(null);
  }, [rootPath]);

  useEffect(() => {
    if (!rootPath) {
      setBranchLabel(null);
      return;
    }
    void refreshBranch();
  }, [refreshBranch, rootPath]);

  const toolbar = (
    <div className="im-project-tools">
      {branchLabel ? (
        <div className="wb-terminal-status">
          <span className="wb-terminal-status-branch" title={branchLabel}>
            <ThemeIcon name="git-branch" size={12} aria-hidden="true" />
            <span className="wb-terminal-status-branch-label">{branchLabel}</span>
          </span>
        </div>
      ) : null}
      <div className="wb-detail-tools">
        <button
          type="button"
          className={`wb-detail-tool${explorerOpen ? " active" : ""}`}
          aria-pressed={explorerOpen}
          disabled={toolsDisabled}
          title={toolsDisabled ? disabledTitle : t("desktop.workbench.sidePanelExplorer")}
          aria-label={t("desktop.workbench.sidePanelExplorer")}
          onClick={() => {
            if (toolsDisabled) return;
            setExplorerOpen((current) => !current);
          }}
        >
          <ThemeIcon name="folder-tree" size={16} />
        </button>
      </div>
    </div>
  );

  const pane = explorerOpen && hasRoot ? (
    <>
      <ResizeHandle
        label={t("desktop.workbench.resizeSidePanel")}
        onDelta={(delta) => {
          const next = Math.max(220, Math.min(520, sideWidth - delta));
          setSideWidth(next);
          try { localStorage.setItem(SIDE_WIDTH_KEY, String(next)); } catch { /* ignore */ }
        }}
      />
      <aside className="wb-side-panel im-project-tools-panel" style={{ width: sideWidth }}>
        <div className="wb-side-pane wb-explorer-side-pane">
          <WorkbenchFileExplorer
            rootPath={rootPath || ""}
            onOpenFile={(path) => void openPath(path)}
            onOpenPreview={(path) => void openPath(path)}
            onError={(message) => notifyDesktop({ text: message, kind: "error" })}
          />
        </div>
      </aside>
    </>
  ) : null;

  return { toolbar, pane };
}
