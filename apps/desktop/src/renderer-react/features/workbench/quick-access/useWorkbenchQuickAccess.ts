import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { desktopApi } from "../../../bridge";
import { useI18n } from "../../../i18n";
import type { QuickAccessFile, QuickAccessMode } from "../QuickAccess";

function statusError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/^Error invoking remote method '[^']+': Error:\s*/, "");
}

function projectPathKey(value = ""): string {
  return value.replaceAll("\\", "/").replace(/\/+$/, "");
}

function storageString(key: string): string {
  try { return localStorage.getItem(key) || ""; } catch { return ""; }
}

export function useWorkbenchQuickAccess(options: {
  selectedProject: string | null;
  quickAccessProjectKey: string;
  onDismissOverlays: () => void;
}): {
  quickAccessOpen: boolean;
  quickAccessMode: QuickAccessMode;
  setQuickAccessMode: (mode: QuickAccessMode) => void;
  quickAccessQuery: string;
  setQuickAccessQuery: (value: string) => void;
  quickAccessFiles: QuickAccessFile[];
  quickAccessSearchFiles: QuickAccessFile[];
  quickAccessSearchTruncated: boolean;
  quickAccessLoading: boolean;
  quickAccessTruncated: boolean;
  quickAccessError: string;
  quickAccessRoot: string;
  quickAccessVisibleFiles: QuickAccessFile[];
  quickAccessProjectContextRef: { current: { mode: Exclude<QuickAccessMode, "projects">; query: string; closeOnSelect: boolean } };
  loadQuickAccessFiles: (rootPath: string) => Promise<void>;
  openQuickAccess: (mode: QuickAccessMode) => void;
  closeQuickAccess: () => void;
  enterQuickAccessProjectMode: (closeOnSelect?: boolean) => void;
  leaveQuickAccessProjectMode: () => void;
  invalidateQuickAccessCache: (rootPath: string) => void;
} {
  const { selectedProject, quickAccessProjectKey, onDismissOverlays } = options;
  const { t } = useI18n();
  const [quickAccessOpen, setQuickAccessOpen] = useState(false);
  const [quickAccessMode, setQuickAccessMode] = useState<QuickAccessMode>("files");
  const [quickAccessQuery, setQuickAccessQuery] = useState("");
  const [quickAccessFiles, setQuickAccessFiles] = useState<QuickAccessFile[]>([]);
  const [quickAccessSearchFiles, setQuickAccessSearchFiles] = useState<QuickAccessFile[]>([]);
  const [quickAccessSearchTruncated, setQuickAccessSearchTruncated] = useState(false);
  const [quickAccessLoading, setQuickAccessLoading] = useState(false);
  const [quickAccessTruncated, setQuickAccessTruncated] = useState(false);
  const [quickAccessError, setQuickAccessError] = useState("");
  const quickAccessCacheRef = useRef(new Map<string, { files: QuickAccessFile[]; truncated: boolean }>());
  const quickAccessRequestRef = useRef(0);
  const quickAccessSearchRequestRef = useRef(0);
  const quickAccessProjectContextRef = useRef<{
    mode: Exclude<QuickAccessMode, "projects">;
    query: string;
    closeOnSelect: boolean;
  }>({ mode: "files", query: "", closeOnSelect: false });
  const onDismissOverlaysRef = useRef(onDismissOverlays);
  onDismissOverlaysRef.current = onDismissOverlays;

  const quickAccessRoot = selectedProject || storageString(quickAccessProjectKey) || "";

  const loadQuickAccessFiles = useCallback(async (rootPath: string) => {
    if (!rootPath) return;
    quickAccessSearchRequestRef.current += 1;
    setQuickAccessSearchFiles([]);
    setQuickAccessSearchTruncated(false);
    const cacheKey = projectPathKey(rootPath);
    const cached = quickAccessCacheRef.current.get(cacheKey);
    if (cached) {
      setQuickAccessFiles(cached.files);
      setQuickAccessTruncated(cached.truncated);
    } else {
      setQuickAccessFiles([]);
      setQuickAccessTruncated(false);
    }
    const sequence = ++quickAccessRequestRef.current;
    setQuickAccessLoading(!cached);
    setQuickAccessError("");
    try {
      const api = desktopApi();
      if (typeof api.workbenchListFiles !== "function") throw new Error(t("desktop.workbench.quickAccessUnavailable"));
      const result = await api.workbenchListFiles({ rootPath });
      if (quickAccessRequestRef.current !== sequence) return;
      quickAccessCacheRef.current.set(cacheKey, { files: result.files, truncated: result.truncated });
      setQuickAccessFiles(result.files);
      setQuickAccessTruncated(result.truncated);
    } catch (error) {
      if (quickAccessRequestRef.current !== sequence || (error as Error)?.name === "AbortError") return;
      setQuickAccessError(statusError(error));
    } finally {
      if (quickAccessRequestRef.current === sequence) setQuickAccessLoading(false);
    }
  }, [t]);

  const openQuickAccess = useCallback((mode: QuickAccessMode) => {
    if (!quickAccessOpen && document.querySelector('[aria-modal="true"]')) return;
    onDismissOverlaysRef.current();
    quickAccessProjectContextRef.current = { mode: "files", query: "", closeOnSelect: false };
    setQuickAccessMode(mode);
    setQuickAccessQuery("");
    setQuickAccessSearchFiles([]);
    setQuickAccessSearchTruncated(false);
    setQuickAccessOpen(true);
  }, [quickAccessOpen]);

  useEffect(() => {
    if (quickAccessOpen && quickAccessMode === "files" && quickAccessRoot) {
      void loadQuickAccessFiles(quickAccessRoot);
    }
  }, [loadQuickAccessFiles, quickAccessMode, quickAccessOpen, quickAccessRoot]);

  useEffect(() => {
    const api = desktopApi();
    const query = quickAccessQuery.trim();
    if (!quickAccessOpen || quickAccessMode !== "files" || !quickAccessRoot || !quickAccessTruncated || !query
      || typeof api.workbenchSearchPaths !== "function") {
      quickAccessSearchRequestRef.current += 1;
      setQuickAccessSearchFiles([]);
      setQuickAccessSearchTruncated(false);
      if (typeof api.workbenchSearchPathsCancel === "function") {
        void api.workbenchSearchPathsCancel().catch(() => undefined);
      }
      return;
    }

    const sequence = ++quickAccessSearchRequestRef.current;
    const timer = window.setTimeout(() => {
      void api.workbenchSearchPaths({ rootPath: quickAccessRoot, query }).then((result) => {
        if (quickAccessSearchRequestRef.current !== sequence) return;
        setQuickAccessSearchFiles(result.files);
        setQuickAccessSearchTruncated(result.truncated);
      }).catch((error) => {
        if (quickAccessSearchRequestRef.current !== sequence || (error as Error)?.name === "AbortError") return;
        setQuickAccessSearchFiles([]);
        setQuickAccessSearchTruncated(false);
      });
    }, 150);

    return () => {
      window.clearTimeout(timer);
      if (typeof api.workbenchSearchPathsCancel === "function") {
        void api.workbenchSearchPathsCancel().catch(() => undefined);
      }
    };
  }, [quickAccessMode, quickAccessOpen, quickAccessQuery, quickAccessRoot, quickAccessTruncated]);

  const closeQuickAccess = useCallback(() => {
    quickAccessRequestRef.current += 1;
    quickAccessSearchRequestRef.current += 1;
    setQuickAccessOpen(false);
    const api = desktopApi();
    if (typeof api.workbenchListFilesCancel === "function") void api.workbenchListFilesCancel().catch(() => undefined);
    if (typeof api.workbenchSearchPathsCancel === "function") void api.workbenchSearchPathsCancel().catch(() => undefined);
  }, []);

  const enterQuickAccessProjectMode = useCallback((closeOnSelect = false) => {
    quickAccessProjectContextRef.current = {
      mode: quickAccessMode === "commands" ? "commands" : "files",
      query: quickAccessQuery,
      closeOnSelect
    };
    setQuickAccessMode("projects");
    setQuickAccessQuery("");
  }, [quickAccessMode, quickAccessQuery]);

  const leaveQuickAccessProjectMode = useCallback(() => {
    const context = quickAccessProjectContextRef.current;
    setQuickAccessMode(context.mode);
    setQuickAccessQuery(context.query);
  }, []);

  useEffect(() => {
    const api = desktopApi();
    const offCmdP = typeof api.onWorkbenchCmdP === "function"
      ? api.onWorkbenchCmdP(() => openQuickAccess("files"))
      : () => undefined;
    const offCmdShiftP = typeof api.onWorkbenchCmdShiftP === "function"
      ? api.onWorkbenchCmdShiftP(() => openQuickAccess("commands"))
      : () => undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.key.toLowerCase() !== "p") return;
      event.preventDefault();
      event.stopPropagation();
      openQuickAccess(event.shiftKey ? "commands" : "files");
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      offCmdP();
      offCmdShiftP();
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [openQuickAccess]);

  const quickAccessVisibleFiles = useMemo(() => {
    if (!quickAccessSearchFiles.length) return quickAccessFiles;
    const byPath = new Map(quickAccessFiles.map((entry) => [entry.path, entry]));
    for (const entry of quickAccessSearchFiles) byPath.set(entry.path, entry);
    return [...byPath.values()];
  }, [quickAccessFiles, quickAccessSearchFiles]);

  const invalidateQuickAccessCache = useCallback((rootPath: string) => {
    quickAccessCacheRef.current.delete(projectPathKey(rootPath));
  }, []);

  return {
    quickAccessOpen,
    quickAccessMode,
    setQuickAccessMode,
    quickAccessQuery,
    setQuickAccessQuery,
    quickAccessFiles,
    quickAccessSearchFiles,
    quickAccessSearchTruncated,
    quickAccessLoading,
    quickAccessTruncated,
    quickAccessError,
    quickAccessRoot,
    quickAccessVisibleFiles,
    quickAccessProjectContextRef,
    loadQuickAccessFiles,
    openQuickAccess,
    closeQuickAccess,
    enterQuickAccessProjectMode,
    leaveQuickAccessProjectMode,
    invalidateQuickAccessCache
  };
}
