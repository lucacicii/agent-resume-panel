import React, { useCallback, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useStage } from "./StageContext";
import { StageArtifactView } from "./StageArtifactView";
import { ICON_SIZE, ThemeIcon, type ThemeIconName } from "../../components/ThemeIcon";
import { useI18n } from "../../i18n";
import type { StageView, UIArtifactEnvelope } from "@agent-resume/core";

function getActiveViewInfo(
  view: StageView,
  activeArtifact?: UIArtifactEnvelope | null,
  t?: (k: string, ...args: (string | number)[]) => string
): { icon: ThemeIconName; title: string } {
  const tr = (k: string, f: string) => {
    try {
      const res = t ? t(k) : f;
      return res || f;
    } catch {
      return f;
    }
  };
  const artKind = activeArtifact?.kind;
  let artIcon: ThemeIconName = "layout-dashboard";
  if (artKind === "native:gtd") artIcon = "square-kanban";
  else if (artKind === "native:notes") artIcon = "notebook";
  else if (artKind === "native:diff") artIcon = "git-branch";
  else if (artKind === "native:browser") artIcon = "globe";
  else if (artKind === "native:memory") artIcon = "sparkles";
  else if (artKind === "native:scripts" || artKind === "native:workbench") artIcon = "terminal";

  switch (view) {
    case "gtd":
      return { icon: "square-kanban", title: tr("desktop.gtd.title", "Tasks") };
    case "notes":
      return { icon: "notebook", title: tr("desktop.notes.title", "Notes") };
    case "schedule":
      return { icon: "clock", title: tr("desktop.schedule.title", "Schedule") };
    case "sessions":
      return { icon: "history", title: tr("desktop.sessions.title", "Sessions") };
    case "archive":
      return { icon: "archive", title: tr("desktop.archive.title", "Archive") };
    case "artifact":
    default:
      return { icon: artIcon, title: activeArtifact?.title || tr("desktop.artifact.title", "Artifact") };
  }
}

function StageSplitter(): React.JSX.Element | null {
  const host = typeof document !== "undefined" ? document.getElementById("react-stage-splitter") : null;
  const { isOpen, width, setStageWidth } = useStage();
  const draggingRef = useRef(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    draggingRef.current = true;
    startXRef.current = e.clientX;
    startWidthRef.current = width;
    document.body.classList.add("is-stage-resizing");

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!draggingRef.current) return;
      const delta = startXRef.current - moveEvent.clientX;
      setStageWidth(startWidthRef.current + delta);
    };

    const handleMouseUp = () => {
      draggingRef.current = false;
      document.body.classList.remove("is-stage-resizing");
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  }, [width, setStageWidth]);

  const handleDoubleClick = useCallback(() => {
    setStageWidth(540);
  }, [setStageWidth]);

  if (!host || !isOpen) return null;

  return createPortal(
    <div
      className="stage-splitter-handle"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize Stage"
      onMouseDown={handleMouseDown}
      onDoubleClick={handleDoubleClick}
      title="Drag to resize, double-click to reset"
    >
      <div className="stage-splitter-line" />
    </div>,
    host
  );
}

function StageHeader(): React.JSX.Element | null {
  const host = typeof document !== "undefined" ? document.getElementById("react-stage-header") : null;
  const { isOpen, view, artifacts, activeArtifactId, activeArtifact, closeStage, focusArtifact, removeArtifact } = useStage();
  const { t } = useI18n();

  if (!host || !isOpen) return null;

  const currentInfo = getActiveViewInfo(view, activeArtifact, t);

  return createPortal(
    <header className="stage-header" aria-label="Adaptive Stage Header">
      <div className="stage-title-group">
        <span className="stage-badge-icon">
          <ThemeIcon name={currentInfo.icon} size={ICON_SIZE.dense} />
        </span>
        <span className="stage-badge-title">{currentInfo.title}</span>
      </div>

      {artifacts.length > 0 && (
        <div className="stage-artifacts-tabs" role="tablist">
          {artifacts.map((art) => {
            const isActive = view === "artifact" && activeArtifactId === art.id;
            return (
              <div
                key={art.id}
                role="tab"
                aria-selected={isActive}
                className={`stage-tab stage-artifact-tab ${isActive ? "is-active" : ""}`}
                onClick={() => focusArtifact(art.id)}
                title={art.title}
              >
                <span className="stage-tab-title">{art.title}</span>
                <button
                  type="button"
                  className="stage-tab-close"
                  aria-label={`Close ${art.title}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    removeArtifact(art.id);
                  }}
                >
                  <ThemeIcon name="close" size={ICON_SIZE.inline} />
                </button>
              </div>
            );
          })}
        </div>
      )}

      <div className="stage-header-actions">
        <button
          type="button"
          className="stage-action-btn"
          aria-label="Close Stage"
          title="Close Stage (Esc)"
          onClick={closeStage}
        >
          <ThemeIcon name="close" size={ICON_SIZE.dense} />
        </button>
      </div>
    </header>,
    host
  );
}

function StageArtifactPortal(): React.JSX.Element | null {
  const host = typeof document !== "undefined" ? document.getElementById("react-stage-artifact") : null;
  const { isOpen, view, activeArtifact } = useStage();

  if (!host || !isOpen || view !== "artifact") return null;

  return createPortal(
    <StageArtifactView artifact={activeArtifact} />,
    host
  );
}

export function StageHost(): React.JSX.Element {
  const { isOpen, width } = useStage();

  // Update CSS variable --stage-width on documentElement
  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.style.setProperty("--stage-width", `${width}px`);
    }
  }, [width]);

  if (!isOpen) return <></>;

  return (
    <>
      <StageSplitter />
      <StageHeader />
      <StageArtifactPortal />
    </>
  );
}
