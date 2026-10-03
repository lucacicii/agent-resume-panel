import React, { useEffect, useRef, useState } from "react";
import { ICON_SIZE, ThemeIcon } from "../../components/ThemeIcon";
import { useI18n } from "../../i18n";
import { FileFootprintList } from "./FileFootprintList";
import { GitDiffPanel } from "./GitDiffPanel";
import type { ConversationChanges } from "./useConversationChanges";
import { useConversationCommit } from "./useConversationCommit";

export type ChatChangesTab = "diff" | "footprint";

export interface ChatChangesPopoverProps {
  isOpen: boolean;
  onClose: () => void;
  workspaceDir: string;
  /** Single data source, shared with the header badge. */
  changes: ConversationChanges;
  onCommitSuccess?: () => void;
}

/**
 * The one Changes panel: a Diff tab (dirty files, per-file selection, commit &
 * push) and a read-only Footprint tab (the full event footprint). Replaces the
 * old Files and Git Diff popovers.
 */
export function ChatChangesPopover({
  isOpen,
  onClose,
  workspaceDir,
  changes,
  onCommitSuccess
}: ChatChangesPopoverProps): React.JSX.Element | null {
  const { t } = useI18n();
  const [tab, setTab] = useState<ChatChangesTab>("diff");
  const initialized = useRef(false);

  const commit = useConversationCommit({
    files: changes.files,
    refresh: changes.refresh,
    onCommitSuccess
  });

  // On the first open, prefer the Footprint tab when nothing is committable but
  // the footprint has entries (otherwise the Diff tab would look empty).
  useEffect(() => {
    if (!isOpen) {
      initialized.current = false;
      return;
    }
    if (initialized.current || !changes.hasLoaded) return;
    initialized.current = true;
    setTab(
      changes.files.length === 0 && changes.noDiffEntries.length > 0 ? "footprint" : "diff"
    );
  }, [isOpen, changes.hasLoaded, changes.files.length, changes.noDiffEntries.length]);

  if (!isOpen) return null;

  const diffCount = changes.files.length;
  const footprintCount = changes.footprintCount;

  return (
    <div className="tb-trace-overlay" onClick={onClose}>
      <div
        className="tb-trace-popover tb-changes-popover"
        onClick={(event) => event.stopPropagation()}
      >
        {/* Header */}
        <div className="tb-trace-header">
          <div className="tb-trace-title-row">
            <div className="tb-trace-title">
              <ThemeIcon name="git-branch" size={ICON_SIZE.dense} />
              <span>{t("desktop.chat.changes.label")}</span>
              <span className="tb-trace-count-badge">
                {diffCount} file{diffCount === 1 ? "" : "s"}
              </span>
            </div>
            <div className="tb-trace-actions">
              <button
                type="button"
                className="tb-trace-refresh-btn"
                onClick={() => void changes.refresh()}
                disabled={changes.isLoading}
                title={t("desktop.chat.changes.refresh")}
              >
                <ThemeIcon
                  name="refresh"
                  size={ICON_SIZE.dense}
                  className={changes.isLoading ? "spin" : ""}
                />
              </button>
              <button
                type="button"
                className="tb-trace-close-btn"
                onClick={onClose}
                title="Close"
              >
                <ThemeIcon name="close" size={ICON_SIZE.dense} />
              </button>
            </div>
          </div>

          {/* Tabs */}
          <div className="tb-changes-tabs" role="tablist" aria-label={t("desktop.chat.changes.label")} onKeyDown={(event) => {
            if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
              event.preventDefault();
              setTab((current) => (current === "diff" ? "footprint" : "diff"));
            }
          }}>
            <button
              type="button"
              role="tab"
              id="tb-changes-tab-diff"
              aria-selected={tab === "diff"}
              aria-controls="tb-changes-panel-diff"
              className={`tb-changes-tab${tab === "diff" ? " is-active" : ""}`}
              onClick={() => setTab("diff")}
              title={t("desktop.chat.changes.tabDiffHint")}
            >
              <span>{t("desktop.chat.changes.tabDiff")}</span>
              <span className="tb-changes-tab-count">{diffCount}</span>
            </button>
            <button
              type="button"
              role="tab"
              id="tb-changes-tab-footprint"
              aria-selected={tab === "footprint"}
              aria-controls="tb-changes-panel-footprint"
              className={`tb-changes-tab${tab === "footprint" ? " is-active" : ""}`}
              onClick={() => setTab("footprint")}
              title={t("desktop.chat.changes.tabFootprintHint")}
            >
              <span>{t("desktop.chat.changes.tabFootprint")}</span>
              <span className="tb-changes-tab-count">{footprintCount}</span>
            </button>
          </div>
        </div>

        {/* Diff tab (lazy: diffs only load while it is active) */}
        <div
          role="tabpanel"
          id="tb-changes-panel-diff"
          aria-labelledby="tb-changes-tab-diff"
          className="tb-changes-tabpanel"
          hidden={tab !== "diff"}
        >
          <GitDiffPanel
            active={tab === "diff"}
            workspaceDir={workspaceDir}
            changes={changes}
            commit={commit}
          />
        </div>

        {/* Footprint tab (read-only) */}
        <div
          role="tabpanel"
          id="tb-changes-panel-footprint"
          aria-labelledby="tb-changes-tab-footprint"
          className="tb-changes-tabpanel"
          hidden={tab !== "footprint"}
        >
          <FileFootprintList files={changes.footprintFiles} workspaceDir={workspaceDir} />
        </div>
      </div>
    </div>
  );
}
