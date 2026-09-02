import { ThemeIcon } from "../../components/ThemeIcon";
import { ResizeHandle } from "../../components/ResizeHandle";
import { notifyDesktop } from "../../components/Notifications";
import { desktopApi } from "../../bridge";
import { useI18n } from "../../i18n";
import { storedWidth } from "../../storage";
import { WorkbenchFileExplorer } from "../workbench/WorkbenchFileExplorer";
import { ImCallChainPane } from "./ImCallChainPane";
import type { ImMember, ImRoom } from "../../../shared/imTypes";
import { useCallback, useEffect, useState, type ReactNode } from "react";

const SIDE_WIDTH_KEY = "im-project-tools-width";

function statusError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface UseImProjectToolsOptions {
  rootPath: string | null;
  room?: ImRoom | null;
  allMembers?: ImMember[];
  onJumpToMessage?: (messageId: string) => void;
}

export type ImActiveSidePane = "explorer" | "call_chain" | null;

export function useImProjectTools(optionsOrRoot: UseImProjectToolsOptions | string | null): {
  toolbar: ReactNode;
  pane: ReactNode;
  activePane: ImActiveSidePane;
  setActivePane: (pane: ImActiveSidePane) => void;
} {
  const { t } = useI18n();
  const options: UseImProjectToolsOptions =
    typeof optionsOrRoot === "string" || optionsOrRoot === null
      ? { rootPath: optionsOrRoot }
      : optionsOrRoot;

  const { rootPath, room, allMembers, onJumpToMessage } = options;
  const [activePane, setActivePane] = useState<ImActiveSidePane>(null);
  const [sideWidth, setSideWidth] = useState(() => storedWidth(SIDE_WIDTH_KEY, 300, 240, 560));
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
    if (activePane === "explorer" && !rootPath) {
      setActivePane(null);
    }
    setBranchLabel(null);
  }, [activePane, rootPath]);

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
          className={`wb-detail-tool${activePane === "call_chain" ? " active" : ""}`}
          aria-pressed={activePane === "call_chain"}
          title={t("desktop.im.callChain")}
          aria-label={t("desktop.im.callChain")}
          onClick={() => {
            setActivePane((current) => (current === "call_chain" ? null : "call_chain"));
          }}
        >
          <ThemeIcon name="waypoints" size={16} />
        </button>
        <button
          type="button"
          className={`wb-detail-tool${activePane === "explorer" ? " active" : ""}`}
          aria-pressed={activePane === "explorer"}
          disabled={toolsDisabled}
          title={toolsDisabled ? disabledTitle : t("desktop.workbench.sidePanelExplorer")}
          aria-label={t("desktop.workbench.sidePanelExplorer")}
          onClick={() => {
            if (toolsDisabled) return;
            setActivePane((current) => (current === "explorer" ? null : "explorer"));
          }}
        >
          <ThemeIcon name="folder-tree" size={16} />
        </button>
      </div>
    </div>
  );

  const pane = activePane === "explorer" && hasRoot ? (
    <>
      <ResizeHandle
        label={t("desktop.workbench.resizeSidePanel")}
        onDelta={(delta) => {
          const next = Math.max(240, Math.min(560, sideWidth - delta));
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
  ) : activePane === "call_chain" ? (
    <>
      <ResizeHandle
        label={t("desktop.workbench.resizeSidePanel")}
        onDelta={(delta) => {
          const next = Math.max(240, Math.min(560, sideWidth - delta));
          setSideWidth(next);
          try { localStorage.setItem(SIDE_WIDTH_KEY, String(next)); } catch { /* ignore */ }
        }}
      />
      <aside className="wb-side-panel im-project-tools-panel im-call-chain-side-panel" style={{ width: sideWidth }}>
        <ImCallChainPane
          room={room ?? null}
          allMembers={allMembers ?? []}
          onJumpToMessage={(msgId) => onJumpToMessage?.(msgId)}
          onClose={() => setActivePane(null)}
          t={t}
        />
      </aside>
    </>
  ) : null;

  return { toolbar, pane, activePane, setActivePane };
}
