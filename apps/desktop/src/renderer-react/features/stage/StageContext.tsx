import React, { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { StageView, UIArtifactEnvelope } from "@agent-resume/core";

const STAGE_VIEW_STORAGE_KEY = "agent-resume:stage-view";
const STAGE_WIDTH_STORAGE_KEY = "agent-resume:stage-width";
const STAGE_OPEN_STORAGE_KEY = "agent-resume:stage-open";

const DEFAULT_STAGE_WIDTH = 540;
const MIN_STAGE_WIDTH = 360;

function storedStageView(): StageView {
  return "artifact";
}

function storedStageOpen(): boolean {
  try {
    const raw = localStorage.getItem(STAGE_OPEN_STORAGE_KEY);
    if (raw !== null) return raw === "1";
    return false; // Default closed: pure single-chat on initial launch
  } catch {
    return false;
  }
}

function storedStageWidth(): number {
  try {
    const raw = localStorage.getItem(STAGE_WIDTH_STORAGE_KEY);
    if (!raw) return DEFAULT_STAGE_WIDTH;
    const parsed = parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed >= MIN_STAGE_WIDTH ? parsed : DEFAULT_STAGE_WIDTH;
  } catch {
    return DEFAULT_STAGE_WIDTH;
  }
}

export interface StageContextValue {
  isOpen: boolean;
  view: StageView;
  width: number;
  artifacts: UIArtifactEnvelope[];
  activeArtifactId: string | null;
  activeArtifact: UIArtifactEnvelope | null;
  openView: (view: Exclude<StageView, "none">, options?: { artifactId?: string }) => void;
  closeStage: () => void;
  toggleStage: (targetView?: Exclude<StageView, "none">) => void;
  setStageWidth: (width: number) => void;
  registerArtifact: (artifact: UIArtifactEnvelope, autoFocus?: boolean) => void;
  focusArtifact: (id: string) => void;
  removeArtifact: (id: string) => void;
}

const StageContext = createContext<StageContextValue | null>(null);

export function StageProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [isOpen, setIsOpen] = useState<boolean>(storedStageOpen);
  const [view, setView] = useState<StageView>(storedStageView);
  const [width, setWidth] = useState<number>(storedStageWidth);
  const [artifacts, setArtifacts] = useState<UIArtifactEnvelope[]>([]);
  const [activeArtifactId, setActiveArtifactId] = useState<string | null>(null);

  // Sync DOM dataset attributes for CSS layout rules
  useEffect(() => {
    document.documentElement.dataset.stageOpen = isOpen ? "true" : "false";
    document.documentElement.dataset.stageView = isOpen ? view : "none";
    try {
      localStorage.setItem(STAGE_OPEN_STORAGE_KEY, isOpen ? "1" : "0");
      if (view !== "none") {
        localStorage.setItem(STAGE_VIEW_STORAGE_KEY, view);
      }
    } catch {
      /* ignore storage errors */
    }
  }, [isOpen, view]);

  // Persist stage width
  const setStageWidth = useCallback((newWidth: number) => {
    const maxAvailable = typeof window !== "undefined" ? Math.max(MIN_STAGE_WIDTH, window.innerWidth - 360) : 1200;
    const clamped = Math.min(Math.max(newWidth, MIN_STAGE_WIDTH), maxAvailable);
    setWidth(clamped);
    try {
      localStorage.setItem(STAGE_WIDTH_STORAGE_KEY, String(clamped));
    } catch {
      /* ignore storage errors */
    }
  }, []);

  const openView = useCallback((targetView: Exclude<StageView, "none">, options?: { artifactId?: string }) => {
    setView(targetView);
    setIsOpen(true);
    if (options?.artifactId) {
      setActiveArtifactId(options.artifactId);
    }
  }, []);

  const closeStage = useCallback(() => {
    setIsOpen(false);
  }, []);

  const toggleStage = useCallback((targetView?: Exclude<StageView, "none">) => {
    setIsOpen((prev) => {
      if (!prev) {
        if (targetView) setView(targetView);
        return true;
      }
      if (targetView && targetView !== view) {
        setView(targetView);
        return true;
      }
      return false;
    });
  }, [view]);

  const registerArtifact = useCallback((artifact: UIArtifactEnvelope, autoFocus = true) => {
    setArtifacts((prev) => {
      const idx = prev.findIndex((a) => a.id === artifact.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = artifact;
        return next;
      }
      return [...prev, artifact];
    });
    if (autoFocus) {
      setActiveArtifactId(artifact.id);
      setView("artifact");
      setIsOpen(true);
    }
  }, []);

  const focusArtifact = useCallback((id: string) => {
    setActiveArtifactId(id);
    setView("artifact");
    setIsOpen(true);
  }, []);

  const removeArtifact = useCallback((id: string) => {
    setArtifacts((prev) => prev.filter((a) => a.id !== id));
    setActiveArtifactId((prev) => (prev === id ? null : prev));
  }, []);

  // Listen to custom window events for loose-coupled triggers
  useEffect(() => {
    const onOpen = (event: Event) => {
      const detail = (event as CustomEvent<{ view?: Exclude<StageView, "none">; artifactId?: string }>).detail;
      openView(detail?.view || "gtd", { artifactId: detail?.artifactId });
    };
    const onClose = () => closeStage();
    const onToggle = (event: Event) => {
      const detail = (event as CustomEvent<{ view?: Exclude<StageView, "none"> }>).detail;
      toggleStage(detail?.view);
    };
    const onArtifact = (event: Event) => {
      const detail = (event as CustomEvent<UIArtifactEnvelope>).detail;
      if (detail && detail.id) {
        registerArtifact(detail, true);
      }
    };

    window.addEventListener("agent-resume:stage-open", onOpen);
    window.addEventListener("agent-resume:stage-close", onClose);
    window.addEventListener("agent-resume:stage-toggle", onToggle);
    window.addEventListener("agent-resume:stage-artifact", onArtifact);

    return () => {
      window.removeEventListener("agent-resume:stage-open", onOpen);
      window.removeEventListener("agent-resume:stage-close", onClose);
      window.removeEventListener("agent-resume:stage-toggle", onToggle);
      window.removeEventListener("agent-resume:stage-artifact", onArtifact);
    };
  }, [openView, closeStage, toggleStage, registerArtifact]);

  const activeArtifact = useMemo(() => {
    if (!activeArtifactId) return artifacts[0] || null;
    return artifacts.find((a) => a.id === activeArtifactId) || null;
  }, [activeArtifactId, artifacts]);

  const contextValue = useMemo<StageContextValue>(() => ({
    isOpen,
    view,
    width,
    artifacts,
    activeArtifactId,
    activeArtifact,
    openView,
    closeStage,
    toggleStage,
    setStageWidth,
    registerArtifact,
    focusArtifact,
    removeArtifact
  }), [
    isOpen,
    view,
    width,
    artifacts,
    activeArtifactId,
    activeArtifact,
    openView,
    closeStage,
    toggleStage,
    setStageWidth,
    registerArtifact,
    focusArtifact,
    removeArtifact
  ]);

  return (
    <StageContext.Provider value={contextValue}>
      {children}
    </StageContext.Provider>
  );
}

export function useStage(): StageContextValue {
  const ctx = useContext(StageContext);
  if (!ctx) {
    throw new Error("useStage must be used within a StageProvider");
  }
  return ctx;
}
