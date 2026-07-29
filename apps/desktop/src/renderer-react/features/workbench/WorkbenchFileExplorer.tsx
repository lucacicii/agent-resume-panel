import { ChevronRight, FileCode2, Folder, FolderOpen, RefreshCw } from "lucide-react";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState
} from "react";
import { desktopApi } from "../../bridge";
import { useI18n } from "../../i18n";

type DesktopApi = ReturnType<typeof desktopApi>;
type DirectoryEntry = Awaited<ReturnType<DesktopApi["workbenchListDirectory"]>>["entries"][number];

export interface WorkbenchFileExplorerHandle {
  refresh: () => Promise<void>;
}

function basename(value = ""): string {
  return value.replaceAll("\\", "/").split("/").filter(Boolean).at(-1) || value;
}

function pathKey(value = ""): string {
  return value.replaceAll("\\", "/").replace(/\/+$/, "");
}

function isPathWithin(value: string, rootPath: string): boolean {
  const candidate = pathKey(value);
  const root = pathKey(rootPath);
  return candidate === root || candidate.startsWith(`${root}/`);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function directoryEntriesEqual(
  current: DirectoryEntry[] | undefined,
  next: DirectoryEntry[]
): boolean {
  if (!current || current.length !== next.length) return false;
  return current.every((entry, index) => {
    const candidate = next[index];
    return entry.name === candidate.name
      && entry.path === candidate.path
      && entry.isDirectory === candidate.isDirectory;
  });
}

export const WorkbenchFileExplorer = forwardRef<WorkbenchFileExplorerHandle, {
  rootPath: string;
  onOpenFile: (path: string) => void | Promise<void>;
  onError: (message: string) => void;
}>(function WorkbenchFileExplorer({ rootPath, onOpenFile, onError }, ref) {
  const { t } = useI18n();
  const [directories, setDirectories] = useState<Record<string, DirectoryEntry[]>>({});
  const [openDirectories, setOpenDirectories] = useState<Set<string>>(new Set());
  const [refreshing, setRefreshing] = useState(false);
  const rootPathRef = useRef(rootPath);
  const onErrorRef = useRef(onError);
  const openDirectoriesRef = useRef(openDirectories);
  const loadSequenceRef = useRef(new Map<string, number>());
  const refreshesRef = useRef(new Map<string, { promise: Promise<void>; queued: boolean }>());
  const refreshingRef = useRef(false);

  useEffect(() => { onErrorRef.current = onError; }, [onError]);
  useEffect(() => { openDirectoriesRef.current = openDirectories; }, [openDirectories]);

  const loadDirectory = useCallback(async (targetRoot: string, directoryPath: string) => {
    const sequence = (loadSequenceRef.current.get(directoryPath) || 0) + 1;
    loadSequenceRef.current.set(directoryPath, sequence);
    try {
      const result = await desktopApi().workbenchListDirectory({
        rootPath: targetRoot,
        dirPath: directoryPath
      });
      if (loadSequenceRef.current.get(directoryPath) !== sequence) return;
      if (pathKey(rootPathRef.current) !== pathKey(targetRoot)) return;
      setDirectories((current) => directoryEntriesEqual(current[directoryPath], result.entries)
        ? current
        : { ...current, [directoryPath]: result.entries });
    } catch (error) {
      if (loadSequenceRef.current.get(directoryPath) !== sequence) return;
      if (pathKey(rootPathRef.current) !== pathKey(targetRoot)) return;
      setDirectories((current) => {
        if (pathKey(directoryPath) === pathKey(targetRoot)) {
          if (current[directoryPath]?.length === 0) return current;
          return { ...current, [directoryPath]: [] };
        }
        const stalePaths = Object.keys(current).filter((cachedPath) => isPathWithin(cachedPath, directoryPath));
        if (!stalePaths.length) return current;
        const next = { ...current };
        for (const cachedPath of stalePaths) delete next[cachedPath];
        return next;
      });
      setOpenDirectories((current) => {
        const next = new Set([...current].filter((item) => !isPathWithin(item, directoryPath)));
        return next.size === current.size ? current : next;
      });
      onErrorRef.current(errorMessage(error));
    }
  }, []);

  const refresh = useCallback((): Promise<void> => {
    const targetRoot = rootPathRef.current;
    if (!targetRoot) return Promise.resolve();
    const key = pathKey(targetRoot);
    const existing = refreshesRef.current.get(key);
    if (existing) {
      existing.queued = true;
      return existing.promise;
    }

    const state = { promise: Promise.resolve(), queued: false };
    const run = async () => {
      do {
        state.queued = false;
        const targets = new Set([targetRoot]);
        for (const directoryPath of openDirectoriesRef.current) {
          if (isPathWithin(directoryPath, targetRoot)) targets.add(directoryPath);
        }
        await Promise.all([...targets].map((directoryPath) => loadDirectory(targetRoot, directoryPath)));
      } while (state.queued && pathKey(rootPathRef.current) === key);
    };
    state.promise = run().finally(() => {
      if (refreshesRef.current.get(key) === state) refreshesRef.current.delete(key);
    });
    refreshesRef.current.set(key, state);
    return state.promise;
  }, [loadDirectory]);

  useImperativeHandle(ref, () => ({ refresh }), [refresh]);

  useEffect(() => {
    rootPathRef.current = rootPath;
    loadSequenceRef.current.clear();
    openDirectoriesRef.current = new Set();
    setDirectories({});
    setOpenDirectories(new Set());
    if (rootPath) void loadDirectory(rootPath, rootPath);
  }, [loadDirectory, rootPath]);

  const refreshManually = async () => {
    if (refreshingRef.current || !rootPathRef.current) return;
    refreshingRef.current = true;
    setRefreshing(true);
    try { await refresh(); }
    finally {
      refreshingRef.current = false;
      setRefreshing(false);
    }
  };

  const toggleDirectory = async (directoryPath: string) => {
    if (!rootPath) return;
    if (openDirectoriesRef.current.has(directoryPath)) {
      setOpenDirectories((current) => {
        const next = new Set(current);
        next.delete(directoryPath);
        return next;
      });
      return;
    }
    await loadDirectory(rootPath, directoryPath);
    if (pathKey(rootPathRef.current) !== pathKey(rootPath)) return;
    setOpenDirectories((current) => new Set(current).add(directoryPath));
  };

  const renderTree = (directoryPath: string, depth: number): React.JSX.Element[] =>
    (directories[directoryPath] || []).flatMap((entry) => {
      const expanded = entry.isDirectory && openDirectories.has(entry.path);
      const activate = () => entry.isDirectory
        ? void toggleDirectory(entry.path)
        : void onOpenFile(entry.path);
      const row = <div
        className="wb-file-tree-row"
        style={{ paddingLeft: `${8 + depth * 14}px` }}
        key={entry.path}
        role="treeitem"
        tabIndex={0}
        aria-expanded={entry.isDirectory ? expanded : undefined}
        onClick={activate}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          activate();
        }}
        onContextMenu={(event) => {
          if (entry.isDirectory) return;
          event.preventDefault();
          void desktopApi().workbenchRevealPath({ rootPath, targetPath: entry.path });
        }}
      >
        {entry.isDirectory
          ? <button type="button" className={`wb-file-tree-chevron${expanded ? " is-expanded" : ""}`} aria-label={expanded ? "Collapse folder" : "Expand folder"} onClick={(event) => { event.stopPropagation(); void toggleDirectory(entry.path); }}><ChevronRight size={14} /></button>
          : <span className="wb-file-tree-chevron is-placeholder" />}
        {entry.isDirectory
          ? <Folder size={15} className="wb-file-tree-icon" />
          : <FileCode2 size={15} className="wb-file-tree-icon" />}
        <span className="wb-file-tree-label" title={entry.path}>{entry.name}</span>
      </div>;
      return expanded ? [row, ...renderTree(entry.path, depth + 1)] : [row];
    });

  return <>
    <div className="wb-side-pane-head">
      <span className="wb-side-pane-title">{t("desktop.workbench.sidePanelExplorer")}</span>
      {rootPath ? <button type="button" className="wb-git-action-btn" disabled={refreshing} onClick={() => void refreshManually()} aria-label={t("desktop.common.refresh")} title={t("desktop.common.refresh")}><RefreshCw size={14} className={refreshing ? "spin" : undefined} /></button> : null}
    </div>
    <div className="wb-file-tree wb-explorer-file-tree" role="tree">
      {rootPath ? <>
        <div className="wb-file-tree-row"><FolderOpen size={15} className="wb-file-tree-icon" /><span className="wb-file-tree-label">{basename(rootPath)}</span></div>
        {renderTree(rootPath, 1)}
      </> : <p className="muted wb-file-tree-empty">{t("desktop.workbench.sidePanelNoRoot")}</p>}
    </div>
  </>;
});
