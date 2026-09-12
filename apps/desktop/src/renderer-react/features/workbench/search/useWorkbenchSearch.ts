import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type MutableRefObject, type RefObject, type SetStateAction } from "react";
import { desktopApi } from "../../../bridge";
import { useI18n } from "../../../i18n";
import { groupSearchMatches, type WorkbenchSearchMatch } from "../WorkbenchSearchPane";

function statusError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/^Error invoking remote method '[^']+': Error:\s*/, "");
}

function normalizeWorkbenchPath(value: string): string {
  const normalized = value.replaceAll("\\", "/");
  const prefix = normalized.startsWith("/") ? "/" : "";
  const parts = normalized.split("/");
  const stack: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (stack.length && stack.at(-1) !== "..") stack.pop();
      else if (!prefix) stack.push(part);
      continue;
    }
    stack.push(part);
  }
  return `${prefix}${stack.join("/")}` || prefix || ".";
}

function storageBoolean(key: string): boolean {
  try { return localStorage.getItem(key) === "true"; } catch { return false; }
}

export function useWorkbenchSearch(options: {
  selectedProject: string | null;
  side: string | null;
  getDirtyEditorPaths: (projectPath: string) => string[];
  onStatus: (status: { text: string; kind?: "error" | "ok" | "warning" }) => void;
  onReconcileEditors: (projectPath: string) => void;
  onOpenSearchSide: () => void;
}): {
  searchQuery: string;
  setSearchQuery: (value: string) => void;
  searchMatchCase: boolean;
  setSearchMatchCase: Dispatch<SetStateAction<boolean>>;
  searchWholeWord: boolean;
  setSearchWholeWord: Dispatch<SetStateAction<boolean>>;
  searchUseRegex: boolean;
  setSearchUseRegex: Dispatch<SetStateAction<boolean>>;
  searchMatches: WorkbenchSearchMatch[];
  searchTruncated: boolean;
  searchLoading: boolean;
  searchError: string;
  searchExpanded: Set<string>;
  setSearchExpanded: Dispatch<SetStateAction<Set<string>>>;
  searchSelectedKey: string;
  setSearchSelectedKey: (value: string) => void;
  searchProjectMode: boolean;
  setSearchProjectMode: (value: boolean) => void;
  searchProjectQuery: string;
  setSearchProjectQuery: (value: string) => void;
  searchProjectSelectionId: string;
  setSearchProjectSelectionId: Dispatch<SetStateAction<string>>;
  searchFilesInclude: string;
  setSearchFilesInclude: (value: string) => void;
  searchFilesExclude: string;
  setSearchFilesExclude: (value: string) => void;
  searchDetailsOpen: boolean;
  searchReplaceOpen: boolean;
  searchReplaceText: string;
  setSearchReplaceText: (value: string) => void;
  searchReplacing: boolean;
  searchInputRef: RefObject<HTMLInputElement | null>;
  searchReplaceInputRef: RefObject<HTMLInputElement | null>;
  searchIncludeInputRef: RefObject<HTMLInputElement | null>;
  searchExcludeInputRef: RefObject<HTMLInputElement | null>;
  searchTimerRef: MutableRefObject<number>;
  searchGroups: ReturnType<typeof groupSearchMatches>;
  searchFileCount: number;
  searchMatchCount: number;
  searchReplaceVisible: boolean;
  runProjectSearch: (query: string, options?: { matchCase?: boolean; wholeWord?: boolean; useRegex?: boolean }) => Promise<void>;
  performSearchReplace: (files: string[], onlyByPath?: Map<string, number>) => Promise<void>;
  findInExplorerFolder: (folderPath: string) => void;
  toggleSearchDetails: () => void;
  toggleSearchReplace: () => void;
  resetSearchProjectMode: () => void;
} {
  const {
    selectedProject,
    side,
    getDirtyEditorPaths,
    onStatus,
    onReconcileEditors,
    onOpenSearchSide
  } = options;
  const { t } = useI18n();
  const [searchQuery, setSearchQuery] = useState("");
  const [searchMatchCase, setSearchMatchCase] = useState(false);
  const [searchWholeWord, setSearchWholeWord] = useState(false);
  const [searchUseRegex, setSearchUseRegex] = useState(false);
  const [searchMatches, setSearchMatches] = useState<WorkbenchSearchMatch[]>([]);
  const [searchTruncated, setSearchTruncated] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [searchExpanded, setSearchExpanded] = useState<Set<string>>(() => new Set());
  const [searchSelectedKey, setSearchSelectedKey] = useState("");
  const [searchProjectMode, setSearchProjectMode] = useState(false);
  const [searchProjectQuery, setSearchProjectQuery] = useState("");
  const [searchProjectSelectionId, setSearchProjectSelectionId] = useState("");
  const [searchFilesInclude, setSearchFilesInclude] = useState("");
  const [searchFilesExclude, setSearchFilesExclude] = useState("");
  const [searchDetailsOpen, setSearchDetailsOpen] = useState(() => storageBoolean("wb-search-details-open"));
  const [searchReplaceOpen, setSearchReplaceOpen] = useState(() => storageBoolean("wb-search-replace-open"));
  const [searchReplaceText, setSearchReplaceText] = useState("");
  const [searchReplacing, setSearchReplacing] = useState(false);
  const searchSeqRef = useRef(0);
  const searchTimerRef = useRef(0);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const searchReplaceInputRef = useRef<HTMLInputElement | null>(null);
  const searchIncludeInputRef = useRef<HTMLInputElement | null>(null);
  const searchExcludeInputRef = useRef<HTMLInputElement | null>(null);

  const runProjectSearch = useCallback(async (query: string, options?: { matchCase?: boolean; wholeWord?: boolean; useRegex?: boolean }) => {
    const trimmed = query.trim();
    if (!selectedProject || !trimmed) {
      searchSeqRef.current += 1;
      setSearchMatches([]);
      setSearchTruncated(false);
      setSearchError("");
      setSearchLoading(false);
      void desktopApi().workbenchSearchTextCancel().catch(() => undefined);
      return;
    }
    if (trimmed.length < 2 && !options?.useRegex && !searchUseRegex) {
      setSearchMatches([]);
      setSearchTruncated(false);
      setSearchError("");
      setSearchLoading(false);
      return;
    }
    const seq = ++searchSeqRef.current;
    setSearchLoading(true);
    setSearchError("");
    try {
      const result = await desktopApi().workbenchSearchText({
        rootPath: selectedProject,
        query: trimmed,
        matchCase: options?.matchCase ?? searchMatchCase,
        wholeWord: options?.wholeWord ?? searchWholeWord,
        useRegex: options?.useRegex ?? searchUseRegex,
        filesToInclude: searchFilesInclude.trim() || undefined,
        filesToExclude: searchFilesExclude.trim() || undefined
      });
      if (seq !== searchSeqRef.current) return;
      setSearchMatches(result.matches);
      setSearchTruncated(result.truncated);
      const firstFiles = new Set<string>();
      for (const match of result.matches) {
        if (firstFiles.size >= 20) break;
        firstFiles.add(match.path);
      }
      setSearchExpanded(firstFiles);
    } catch (error) {
      if (seq !== searchSeqRef.current) return;
      if ((error as Error)?.name === "AbortError" || /cancel/i.test(String((error as Error)?.message || ""))) {
        setSearchLoading(false);
        return;
      }
      setSearchMatches([]);
      setSearchTruncated(false);
      setSearchError(t("desktop.workbench.searchFailed", statusError(error)));
    } finally {
      if (seq === searchSeqRef.current) setSearchLoading(false);
    }
  }, [searchFilesExclude, searchFilesInclude, searchMatchCase, searchUseRegex, searchWholeWord, selectedProject, t]);

  useEffect(() => {
    if (side !== "search") return;
    window.clearTimeout(searchTimerRef.current);
    searchTimerRef.current = window.setTimeout(() => {
      void runProjectSearch(searchQuery);
    }, 300);
    return () => window.clearTimeout(searchTimerRef.current);
  }, [runProjectSearch, searchFilesExclude, searchFilesInclude, searchMatchCase, searchQuery, searchUseRegex, searchWholeWord, side, selectedProject]);

  const performSearchReplace = useCallback(async (
    files: string[],
    onlyByPath?: Map<string, number>
  ) => {
    const projectPath = selectedProject;
    const trimmedQuery = searchQuery.trim();
    if (!projectPath || !trimmedQuery || searchReplacing || !files.length) return;
    const dirtyOpen = new Set(getDirtyEditorPaths(projectPath).map(normalizeWorkbenchPath));
    const targets = files.filter((file) => !dirtyOpen.has(normalizeWorkbenchPath(file)));
    const skippedDirtyCount = files.length - targets.length;
    if (!targets.length) {
      onStatus({ text: t("desktop.workbench.searchReplaceBlockedDirty"), kind: "error" });
      return;
    }
    setSearchReplacing(true);
    try {
      const result = await desktopApi().workbenchReplaceText({
        rootPath: projectPath,
        query: trimmedQuery,
        replaceWith: searchReplaceText,
        matchCase: searchMatchCase,
        wholeWord: searchWholeWord,
        useRegex: searchUseRegex,
        files: targets,
        only: onlyByPath && onlyByPath.size
          ? [...onlyByPath].map(([path, ordinal]) => ({ path, ordinal }))
          : undefined
      });
      const replacedFiles = result.replaced.length;
      const skippedCount = skippedDirtyCount + result.skipped.length;
      if (replacedFiles > 0) {
        let text = t("desktop.workbench.searchReplaceDone", String(result.totalReplaced), String(replacedFiles));
        if (skippedCount > 0) {
          text += ` · ${t("desktop.workbench.searchReplaceSkipped", String(skippedCount))}`;
        }
        onStatus({ text, kind: "ok" });
        window.clearTimeout(searchTimerRef.current);
        void runProjectSearch(searchQuery);
        onReconcileEditors(projectPath);
      } else if (skippedCount > 0) {
        onStatus({ text: t("desktop.workbench.searchReplaceBlockedDirty"), kind: "error" });
      }
    } catch (error) {
      onStatus({ text: t("desktop.workbench.searchReplaceFailed", statusError(error)), kind: "error" });
    } finally {
      setSearchReplacing(false);
    }
  }, [getDirtyEditorPaths, onReconcileEditors, onStatus, runProjectSearch, searchMatchCase, searchQuery, searchReplacing, searchReplaceText, searchUseRegex, searchWholeWord, selectedProject, t]);

  const findInExplorerFolder = useCallback((folderPath: string) => {
    const projectRoot = selectedProject;
    if (!projectRoot) return;
    const root = normalizeWorkbenchPath(projectRoot);
    const folder = normalizeWorkbenchPath(folderPath);
    if (folder !== root && !folder.startsWith(`${root}/`)) return;
    const relative = folder === root ? "" : folder.slice(root.length).replace(/^\/+/, "");
    setSearchProjectMode(false);
    setSearchProjectQuery("");
    if (relative) {
      setSearchFilesInclude(`${relative}/**`);
      setSearchDetailsOpen(true);
      localStorage.setItem("wb-search-details-open", "true");
    } else {
      setSearchFilesInclude("");
    }
    onOpenSearchSide();
    window.requestAnimationFrame(() => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    });
  }, [onOpenSearchSide, selectedProject]);

  useEffect(() => {
    if (side === "search") {
      window.requestAnimationFrame(() => searchInputRef.current?.focus());
      return;
    }
    setSearchProjectMode(false);
    setSearchProjectQuery("");
  }, [side]);

  const searchGroups = useMemo(() => groupSearchMatches(searchMatches), [searchMatches]);
  const searchFileCount = searchGroups.length;
  const searchMatchCount = searchMatches.length;
  const searchReplaceVisible = searchReplaceOpen
    && !searchLoading
    && !searchReplacing
    && searchMatchCount > 0
    && !searchTruncated
    && Boolean(selectedProject);

  const toggleSearchDetails = useCallback(() => {
    setSearchDetailsOpen((current) => {
      const next = !current;
      localStorage.setItem("wb-search-details-open", String(next));
      return next;
    });
  }, []);

  const toggleSearchReplace = useCallback(() => {
    setSearchReplaceOpen((current) => {
      const next = !current;
      localStorage.setItem("wb-search-replace-open", String(next));
      if (next) window.requestAnimationFrame(() => searchReplaceInputRef.current?.focus());
      return next;
    });
  }, []);

  const resetSearchProjectMode = useCallback(() => {
    setSearchProjectMode(false);
    setSearchProjectQuery("");
    window.requestAnimationFrame(() => searchInputRef.current?.focus());
  }, []);

  return {
    searchQuery,
    setSearchQuery,
    searchMatchCase,
    setSearchMatchCase,
    searchWholeWord,
    setSearchWholeWord,
    searchUseRegex,
    setSearchUseRegex,
    searchMatches,
    searchTruncated,
    searchLoading,
    searchError,
    searchExpanded,
    setSearchExpanded,
    searchSelectedKey,
    setSearchSelectedKey,
    searchProjectMode,
    setSearchProjectMode,
    searchProjectQuery,
    setSearchProjectQuery,
    searchProjectSelectionId,
    setSearchProjectSelectionId,
    searchFilesInclude,
    setSearchFilesInclude,
    searchFilesExclude,
    setSearchFilesExclude,
    searchDetailsOpen,
    searchReplaceOpen,
    searchReplaceText,
    setSearchReplaceText,
    searchReplacing,
    searchInputRef,
    searchReplaceInputRef,
    searchIncludeInputRef,
    searchExcludeInputRef,
    searchTimerRef,
    searchGroups,
    searchFileCount,
    searchMatchCount,
    searchReplaceVisible,
    runProjectSearch,
    performSearchReplace,
    findInExplorerFolder,
    toggleSearchDetails,
    toggleSearchReplace,
    resetSearchProjectMode
  };
}
