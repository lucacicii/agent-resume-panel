import { ICON_SIZE, ThemeIcon, type ThemeIconName } from "../../components/ThemeIcon";
import {
  Fragment,
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState
} from "react";
import { desktopApi } from "../../bridge";
import { notifyDesktop } from "../../components/Notifications";
import { useI18n } from "../../i18n";
import { contextMenuPoint, showContextMenuAt, type NativeContextMenuItem } from "../../nativeContextMenu";
import { useMountedRef } from "../../components/useOverlayMotion";
import { startWorkbenchPathDrag } from "./workbenchDnd";

type DesktopApi = ReturnType<typeof desktopApi>;
type DirectoryEntry = Awaited<ReturnType<DesktopApi["workbenchListDirectory"]>>["entries"][number];

interface ExplorerTarget {
  path: string;
  isDirectory: boolean;
}

export interface WorkbenchFileExplorerHandle {
  refresh: () => Promise<void>;
  revealPath: (targetPath: string) => Promise<void>;
}

// File-type accents are the single sanctioned icon color exception; everything
// else inherits `currentColor`. See themeIconContract.test.ts.
const FILE_ICON_COLORS = {
  folder: "#dcb67a"
} as const;

function getFileIconComponent(filename: string): { name: ThemeIconName; color?: string } {
  // Handle exact filenames for common configuration files
  const name = filename.toLowerCase();
  
  // Build tools & configs
  if (name === "dockerfile" || name === ".dockerignore") return { name: "file-terminal", color: "#0db7ed" }; // Docker Blue
  if (name.includes("vite.config")) return { name: "file-cog", color: "#646cff" }; // Vite Purple
  if (name.includes("webpack.config")) return { name: "file-cog", color: "#8dd6f9" }; // Webpack Blue
  if (name.includes("rollup.config")) return { name: "file-cog", color: "#ec4a3f" }; // Rollup Red
  if (name === "tsconfig.json" || name === "jsconfig.json") return { name: "file-json", color: "#3178c6" }; // TS Blue
  if (name === "pom.xml") return { name: "file-cog", color: "#c71a36" }; // Maven Red
  if (name === "build.gradle" || name === "settings.gradle") return { name: "file-cog", color: "#02303a" }; // Gradle Blue
  if (name === "requirements.txt" || name === "pipfile" || name === "pipfile.lock") return { name: "file-cog", color: "#3572A5" }; // Python Blue
  if (name === "pyproject.toml" || name === "setup.py" || name === "setup.cfg") return { name: "file-cog", color: "#3572A5" }; // Python Blue
  
  // Linters and formatters
  if (name.includes("eslint")) return { name: "file-cog", color: "#4b32c3" }; // ESLint Purple
  if (name.includes("prettier")) return { name: "file-cog", color: "#f7ba3e" }; // Prettier Yellow
  if (name.includes("stylelint")) return { name: "file-cog", color: "#dd1155" }; // Stylelint Pink
  if (name === ".babelrc" || name.includes("babel.config")) return { name: "file-cog", color: "#f5da55" }; // Babel Yellow
  
  // Package managers
  if (name === "package.json") return { name: "file-json", color: "#cb3837" }; // npm Red
  if (name === "package-lock.json") return { name: "file-json", color: "#cb3837" };
  if (name === "yarn.lock" || name === ".yarnrc") return { name: "file-json", color: "#2c8ebb" }; // Yarn Blue
  if (name === "pnpm-lock.yaml" || name === ".pnpmfile.cjs") return { name: "file-json", color: "#f69220" }; // pnpm Orange
  
  if (name === ".gitignore" || name === ".npmrc" || name.endsWith("rc") || name === ".nvmrc") return { name: "file-cog", color: "#6e7681" }; // Config Grey
  if (name === ".env" || name.startsWith(".env.")) return { name: "file-cog", color: "#ebd144" }; // Env Yellow

  // Handle by extension
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  switch (ext) {
    case "vue":
      return { name: "file-code", color: "#41b883" }; // Vue Green
    case "svelte":
      return { name: "file-code", color: "#ff3e00" }; // Svelte Orange
    case "astro":
      return { name: "file-code", color: "#ff5d01" }; // Astro Orange
    case "json":
    case "lock":
      return { name: "file-json", color: "#cbcb41" }; // Yellowish
    case "png":
    case "jpg":
    case "jpeg":
    case "gif":
    case "svg":
    case "webp":
    case "ico":
      return { name: "file-image", color: "#a074c4" }; // Purple
    case "zip":
    case "tar":
    case "gz":
    case "rar":
    case "7z":
      return { name: "file-archive", color: "#e37933" }; // Orange
    case "mp3":
    case "wav":
    case "ogg":
    case "flac":
      return { name: "file-audio", color: "#e37933" };
    case "mp4":
    case "webm":
    case "mov":
    case "mkv":
      return { name: "file-video", color: "#e37933" };
    case "txt":
    case "md":
    case "mdx":
    case "log":
      return { name: "file-text", color: "#519aba" }; // Blue
    case "pdf":
      return { name: "file-text", color: "#b30b00" }; // PDF Red
    case "csv":
    case "xls":
    case "xlsx":
      return { name: "file-spreadsheet", color: "#217346" }; // Excel Green
    case "doc":
    case "docx":
      return { name: "file-text", color: "#2b579a" }; // Word Blue
    case "js":
    case "jsx":
    case "mjs":
    case "cjs":
      return { name: "file-code", color: "#f1e05a" }; // JS Yellow
    case "ts":
    case "tsx":
      return { name: "file-code", color: "#3178c6" }; // TS Blue
    case "html":
    case "htm":
    case "xml":
      return { name: "file-code", color: "#e34c26" }; // HTML Red
    case "css":
    case "scss":
    case "less":
      return { name: "file-code", color: "#563d7c" }; // CSS Purple
    case "py":
    case "pyw":
      return { name: "file-code", color: "#3572A5" }; // Python Blue
    case "pyc":
    case "pyd":
    case "pyo":
      return { name: "file-archive", color: "#519aba" }; // Python Bytecode
    case "java":
    case "jsp":
      return { name: "file-code", color: "#b07219" }; // Java Brown
    case "class":
      return { name: "file-code", color: "#b07219" }; // Java Class
    case "jar":
    case "war":
    case "ear":
      return { name: "file-archive", color: "#b07219" }; // Java Archive
    case "properties":
      return { name: "file-cog", color: "#b07219" }; // Java Properties
    case "c":
    case "cpp":
    case "h":
    case "hpp":
      return { name: "file-code", color: "#f34b7d" }; // C++ Pink
    case "go":
      return { name: "file-code", color: "#00ADD8" }; // Go Cyan
    case "rs":
      return { name: "file-code", color: "#dea584" }; // Rust Peach
    case "sh":
    case "bash":
    case "zsh":
      return { name: "file-terminal", color: "#4eaa25" }; // Shell Green
    case "yml":
    case "yaml":
    case "toml":
    case "ini":
    case "conf":
      return { name: "file-cog", color: "#6e7681" }; // Grey config
    default:
      return { name: "file" }; // Inherits default text color
  }
}

function basename(value = ""): string {
  return value.replaceAll("\\", "/").split("/").filter(Boolean).at(-1) || value;
}

/** Case-insensitive `.md` files support inline preview; `.mdx` is out of scope. */
function isMarkdownFilePath(path: string): boolean {
  return path.toLowerCase().endsWith(".md");
}

function pathKey(value = ""): string {
  return value.replaceAll("\\", "/").replace(/\/+$/, "");
}

function parentPath(value: string): string {
  const normalized = value.replaceAll("\\", "/").replace(/\/+$/, "");
  const separator = normalized.lastIndexOf("/");
  if (separator <= 0) return value;
  return normalized.slice(0, separator);
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
  /** Every project root the explorer spans; one root restores the single-project tree. */
  roots: string[];
  activePath?: string;
  onOpenFile: (path: string) => void | Promise<void>;
  /** Opens an `.md` file directly in preview mode. */
  onOpenPreview?: (path: string) => void | Promise<void>;
  onShowGitHistory?: (path: string) => void | Promise<void>;
  /** Search scope target: the folder itself, or the parent folder for files. */
  onFindInFolder?: (directoryPath: string) => void | Promise<void>;
  onError: (message: string) => void;
}>(function WorkbenchFileExplorer({ roots, activePath = "", onOpenFile, onOpenPreview, onShowGitHistory, onFindInFolder, onError }, ref) {
  const { t } = useI18n();
  const [directories, setDirectories] = useState<Record<string, DirectoryEntry[]>>({});
  const [openDirectories, setOpenDirectories] = useState<Set<string>>(new Set());
  const [selectedPath, setSelectedPath] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const mountedRef = useMountedRef();
  const rootsRef = useRef(roots);
  rootsRef.current = roots;
  /** Identity of the root set; changes reset the tree even when the array reference is new. */
  const rootsKey = roots.map(pathKey).join("\0");
  /** The root an absolute path belongs to (longest match), or "" when outside every root. */
  const rootForPath = useCallback((targetPath: string): string => {
    let best = "";
    for (const root of rootsRef.current) {
      if (pathKey(root).length > pathKey(best).length && isPathWithin(targetPath, root)) best = root;
    }
    return best;
  }, []);
  const onErrorRef = useRef(onError);
  const openDirectoriesRef = useRef(openDirectories);
  const loadSequenceRef = useRef(new Map<string, number>());
  const refreshesRef = useRef(new Map<string, { promise: Promise<void>; queued: boolean }>());
  const refreshingRef = useRef(false);
  const focusSelectedPathRef = useRef(false);
  const reportStatus = (message: string, kind: "ok" | "info" = "ok") => {
    notifyDesktop({ text: message, kind });
  };

  useEffect(() => { onErrorRef.current = onError; }, [onError]);
  useEffect(() => { openDirectoriesRef.current = openDirectories; }, [openDirectories]);
  useEffect(() => {
    if (!selectedPath || !focusSelectedPathRef.current) return;
    const target = pathKey(selectedPath);
    const row = [...document.querySelectorAll<HTMLElement>("[data-wb-entry-path]")]
      .find((element) => pathKey(element.dataset.wbEntryPath || "") === target);
    if (!row) return;
    focusSelectedPathRef.current = false;
    row.focus();
    row.scrollIntoView?.({ block: "nearest" });
  }, [directories, openDirectories, selectedPath]);

  useEffect(() => {
    if (!activePath || !rootForPath(activePath)) return;
    const target = pathKey(activePath);
    const frame = window.requestAnimationFrame(() => {
      const row = [...document.querySelectorAll<HTMLElement>("[data-wb-entry-path]")]
        .find((element) => pathKey(element.dataset.wbEntryPath || "") === target);
      row?.scrollIntoView?.({ block: "nearest" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activePath, directories, openDirectories, rootForPath]);

  const loadDirectory = useCallback(async (targetRoot: string, directoryPath: string) => {
    const sequence = (loadSequenceRef.current.get(directoryPath) || 0) + 1;
    loadSequenceRef.current.set(directoryPath, sequence);
    try {
      const result = await desktopApi().workbenchListDirectory({
        rootPath: targetRoot,
        dirPath: directoryPath
      });
      if (loadSequenceRef.current.get(directoryPath) !== sequence) return;
      if (!rootsRef.current.some((root) => pathKey(root) === pathKey(targetRoot))) return;
      setDirectories((current) => directoryEntriesEqual(current[directoryPath], result.entries)
        ? current
        : { ...current, [directoryPath]: result.entries });
    } catch (error) {
      if (loadSequenceRef.current.get(directoryPath) !== sequence) return;
      if (!rootsRef.current.some((root) => pathKey(root) === pathKey(targetRoot))) return;
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
    const currentRoots = rootsRef.current;
    if (!currentRoots.length) return Promise.resolve();
    const key = currentRoots.map(pathKey).join("\0");
    const existing = refreshesRef.current.get(key);
    if (existing) {
      existing.queued = true;
      return existing.promise;
    }

    const state = { promise: Promise.resolve(), queued: false };
    const run = async () => {
      do {
        state.queued = false;
        await Promise.all(currentRoots.map((targetRoot) => {
          const targets = new Set([targetRoot]);
          for (const directoryPath of openDirectoriesRef.current) {
            if (isPathWithin(directoryPath, targetRoot)) targets.add(directoryPath);
          }
          return Promise.all([...targets].map((directoryPath) => loadDirectory(targetRoot, directoryPath)));
        }));
      } while (state.queued && rootsRef.current.map(pathKey).join("\0") === key);
    };
    state.promise = run().finally(() => {
      if (refreshesRef.current.get(key) === state) refreshesRef.current.delete(key);
    });
    refreshesRef.current.set(key, state);
    return state.promise;
  }, [loadDirectory]);

  const revealPath = useCallback(async (targetPath: string): Promise<void> => {
    const targetRoot = rootForPath(targetPath);
    if (!targetRoot) return;
    const root = pathKey(targetRoot);
    const target = pathKey(targetPath);
    const relative = target === root ? "" : target.slice(root.length).replace(/^\/+/, "");
    const segments = relative.split("/").filter(Boolean);
    const directoriesToOpen: string[] = [];
    let current = root;
    for (const segment of segments) {
      current = `${current}/${segment}`;
      directoriesToOpen.push(current);
    }

    await loadDirectory(targetRoot, targetRoot);
    for (const directoryPath of directoriesToOpen) {
      await loadDirectory(targetRoot, directoryPath);
    }
    if (!rootsRef.current.some((candidate) => pathKey(candidate) === root)) return;
    const nextOpenDirectories = new Set(openDirectoriesRef.current);
    for (const directoryPath of directoriesToOpen) nextOpenDirectories.add(directoryPath);
    openDirectoriesRef.current = nextOpenDirectories;
    setOpenDirectories(nextOpenDirectories);
    focusSelectedPathRef.current = true;
    setSelectedPath(targetPath);

  }, [loadDirectory, rootForPath]);

  useImperativeHandle(ref, () => ({ refresh, revealPath }), [refresh, revealPath]);

  useEffect(() => {
    const currentRoots = rootsRef.current;
    loadSequenceRef.current.clear();
    openDirectoriesRef.current = new Set(currentRoots);
    setDirectories({});
    setOpenDirectories(new Set(currentRoots));
    setSelectedPath("");
    for (const root of currentRoots) void loadDirectory(root, root);
  }, [loadDirectory, rootsKey]);

  useEffect(() => {
    const targetRoot = rootForPath(activePath);
    if (!activePath || !targetRoot) return;
    let cancelled = false;
    const root = pathKey(targetRoot);
    const target = pathKey(activePath);
    const relative = target === root ? "" : target.slice(root.length).replace(/^\/+/, "");
    const segments = relative.split("/").filter(Boolean).slice(0, -1);
    const directoriesToOpen: string[] = [];
    let current = root;
    for (const segment of segments) {
      current = `${current}/${segment}`;
      directoriesToOpen.push(current);
    }

    void (async () => {
      await loadDirectory(targetRoot, targetRoot);
      for (const directoryPath of directoriesToOpen) {
        await loadDirectory(targetRoot, directoryPath);
      }
      if (cancelled || !rootsRef.current.some((candidate) => pathKey(candidate) === root)) return;
      setOpenDirectories((currentOpenDirectories) => {
        const next = new Set(currentOpenDirectories);
        for (const directoryPath of directoriesToOpen) next.add(directoryPath);
        openDirectoriesRef.current = next;
        return next;
      });
      setSelectedPath(activePath);
    })();

    return () => { cancelled = true; };
  }, [activePath, loadDirectory, rootForPath]);

  const refreshManually = async () => {
    if (refreshingRef.current || !rootsRef.current.length) return;
    refreshingRef.current = true;
    setRefreshing(true);
    try { await refresh(); }
    finally {
      refreshingRef.current = false;
      setRefreshing(false);
    }
  };

  const toggleDirectory = async (directoryPath: string) => {
    const targetRoot = rootForPath(directoryPath);
    if (!targetRoot) return;
    if (openDirectoriesRef.current.has(directoryPath)) {
      setOpenDirectories((current) => {
        const next = new Set(current);
        next.delete(directoryPath);
        return next;
      });
      return;
    }
    await loadDirectory(targetRoot, directoryPath);
    if (!rootsRef.current.some((candidate) => pathKey(candidate) === pathKey(targetRoot))) return;
    setOpenDirectories((current) => new Set(current).add(directoryPath));
  };

  const copyTarget = async (target: ExplorerTarget) => {
    const targetRoot = rootForPath(target.path);
    if (!targetRoot) return;
    try {
      await desktopApi().workbenchCopyPath({ rootPath: targetRoot, sourcePath: target.path });
      reportStatus(t("desktop.workbench.explorerCopied", basename(target.path)));
    } catch (error) {
      onError(t("desktop.workbench.explorerCopyFailed", errorMessage(error)));
    }
  };

  const copyPathTarget = (target: ExplorerTarget) => {
    try {
      desktopApi().clipboardWriteText(target.path);
      reportStatus(t("desktop.workbench.explorerPathCopied"));
    } catch (error) {
      onError(t("desktop.workbench.explorerCopyPathFailed", errorMessage(error)));
    }
  };

  const pasteTarget = async (target: ExplorerTarget) => {
    const targetRoot = rootForPath(target.path);
    if (!targetRoot) return;
    const targetDirectory = target.isDirectory ? target.path : parentPath(target.path);
    try {
      const result = await desktopApi().workbenchPastePaths({ rootPath: targetRoot, targetDirectory });
      if (result.copied.length) await refresh();
      if (!result.copied.length && !result.failures.length) {
        reportStatus(t("desktop.workbench.explorerClipboardEmpty"), "info");
      } else if (result.failures.length && result.copied.length) {
        reportStatus(t(
          "desktop.workbench.explorerPastePartial",
          String(result.copied.length),
          String(result.failures.length)
        ), "info");
      } else if (result.failures.length) {
        onError(t("desktop.workbench.explorerPasteFailed", result.failures[0]?.message || ""));
      } else {
        reportStatus(t("desktop.workbench.explorerPasteSucceeded", String(result.copied.length)));
      }
    } catch (error) {
      onError(t("desktop.workbench.explorerPasteFailed", errorMessage(error)));
    }
  };

  const revealTarget = async (target: ExplorerTarget) => {
    const targetRoot = rootForPath(target.path);
    if (!targetRoot) return;
    try {
      await desktopApi().workbenchRevealPath({ rootPath: targetRoot, targetPath: target.path });
    } catch (error) {
      onError(t("desktop.workbench.sidePanelRevealFailed", errorMessage(error)));
    }
  };

  const showGitHistoryTarget = async (target: ExplorerTarget) => {
    if (target.isDirectory || !onShowGitHistory) return;
    await onShowGitHistory(target.path);
  };

  const findInFolderTarget = (target: ExplorerTarget) => {
    if (!onFindInFolder) return;
    // A file scopes to its containing folder; a folder scopes to itself.
    const scope = target.isDirectory ? target.path : parentPath(target.path);
    if (!scope) return;
    void onFindInFolder(scope);
  };

  const previewTarget = (target: ExplorerTarget) => {
    if (target.isDirectory || !onOpenPreview) return;
    void onOpenPreview(target.path);
  };

  /** Native menu: the clipboard check has to settle before the menu can gray Paste. */
  const openContextMenu = async (event: React.MouseEvent<HTMLElement>, target: ExplorerTarget) => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.focus();
    setSelectedPath(target.path);
    let clipboardHasFiles = false;
    try {
      clipboardHasFiles = (await desktopApi().workbenchClipboardHasFiles()).hasFiles;
    } catch {
      // Paste stays disabled when the clipboard cannot be read.
    }
    if (!mountedRef.current) return;
    const items: NativeContextMenuItem[] = [];
    if (!target.isDirectory && isMarkdownFilePath(target.path) && onOpenPreview) {
      items.push({ id: "preview", label: t("desktop.workbench.preview") });
    }
    items.push(
      { id: "copy", label: t("desktop.common.copy") },
      { id: "copy-path", label: t("desktop.common.copyPath") },
      { id: "paste", label: t("desktop.common.paste"), enabled: clipboardHasFiles },
      { type: "separator" }
    );
    if (!target.isDirectory && onShowGitHistory) {
      items.push({ id: "git-history", label: t("desktop.workbench.explorerGitFileHistory") });
    }
    if (onFindInFolder) items.push({ id: "find-in-folder", label: t("desktop.workbench.findInFolder") });
    items.push({ id: "reveal", label: t("desktop.workbench.explorerRevealInFinder") });

    const choice = await showContextMenuAt(contextMenuPoint(event), items);
    // A menu can outlive its window; never act on an unmounted tree.
    if (!mountedRef.current) return;
    if (choice === "preview") previewTarget(target);
    else if (choice === "copy") void copyTarget(target);
    else if (choice === "copy-path") copyPathTarget(target);
    else if (choice === "paste") void pasteTarget(target);
    else if (choice === "git-history") void showGitHistoryTarget(target);
    else if (choice === "find-in-folder") findInFolderTarget(target);
    else if (choice === "reveal") void revealTarget(target);
  };

  const handleTreeKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
    const key = event.key.toLowerCase();
    if (key !== "c" && key !== "v") return;
    const fallbackRoot = rootsRef.current[0] || "";
    const row = (event.target as HTMLElement).closest<HTMLElement>("[data-wb-entry-path]");
    const target: ExplorerTarget = row
      ? {
          path: row.dataset.wbEntryPath || fallbackRoot,
          isDirectory: row.dataset.wbEntryDirectory === "true"
        }
      : { path: fallbackRoot, isDirectory: true };
    if (!target.path) return;
    event.preventDefault();
    event.stopPropagation();
    if (key === "c") void copyTarget(target);
    else void pasteTarget(target);
  };

  const renderTree = (directoryPath: string, depth: number): React.JSX.Element[] =>
    (directories[directoryPath] || []).flatMap((entry) => {
      const expanded = entry.isDirectory && openDirectories.has(entry.path);
      const highlighted = selectedPath === entry.path;
      const activate = () => entry.isDirectory
        ? void toggleDirectory(entry.path)
        : void onOpenFile(entry.path);
      const row = <div
        className={`wb-file-tree-row${highlighted ? " is-selected" : ""}`}
        style={{ paddingLeft: `${8 + depth * 14}px` }}
        key={entry.path}
        role="treeitem"
        tabIndex={0}
        data-wb-entry-path={entry.path}
        data-wb-entry-directory={String(entry.isDirectory)}
        aria-selected={highlighted}
        aria-expanded={entry.isDirectory ? expanded : undefined}
        draggable
        onFocus={() => setSelectedPath(entry.path)}
        onClick={(event) => { event.currentTarget.focus(); activate(); }}
        onDragStart={(event) => startWorkbenchPathDrag(event, entry.path)}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          activate();
        }}
        onContextMenu={(event) => openContextMenu(event, entry)}
      >
        {entry.isDirectory
          ? <button type="button" className={`wb-file-tree-chevron${expanded ? " is-expanded" : ""}`} aria-label={expanded ? "Collapse folder" : "Expand folder"} onClick={(event) => { event.stopPropagation(); void toggleDirectory(entry.path); }}><ThemeIcon name="chevron-right" size={ICON_SIZE.dense} /></button>
          : <span className="wb-file-tree-chevron is-placeholder" />}
        {(() => {
          if (entry.isDirectory) {
            return <ThemeIcon name="folder" size={ICON_SIZE.dense} color={FILE_ICON_COLORS.folder} className="wb-file-tree-icon" />;
          }
          const { name, color } = getFileIconComponent(entry.name);
          return <ThemeIcon name={name} size={ICON_SIZE.dense} color={color} className="wb-file-tree-icon" />;
        })()}
        <span className="wb-file-tree-label" title={entry.path}>{entry.name}</span>
      </div>;
      return expanded ? [row, ...renderTree(entry.path, depth + 1)] : [row];
    });

  return <>
    <div className="wb-side-pane-head">
      <span className="wb-side-pane-title">{t("desktop.workbench.sidePanelExplorer")}</span>
      {roots.length ? <button type="button" className="wb-git-action-btn" disabled={refreshing} onClick={() => void refreshManually()} aria-label={t("desktop.common.refresh")} title={t("desktop.common.refresh")}><ThemeIcon name="refresh" size={ICON_SIZE.default} className={refreshing ? "spin" : undefined} /></button> : null}
    </div>
    <div className="wb-file-tree wb-explorer-file-tree" role="tree" tabIndex={0} onKeyDown={handleTreeKeyDown}>
      {roots.length ? roots.map((root) => {
        const expanded = openDirectories.has(root);
        return <Fragment key={root}>
          <div
            className={`wb-file-tree-row${selectedPath === root ? " is-selected" : ""}`}
            role="treeitem"
            tabIndex={0}
            data-wb-entry-path={root}
            data-wb-entry-directory="true"
            aria-selected={selectedPath === root}
            aria-expanded={roots.length > 1 ? expanded : undefined}
            draggable
            onFocus={() => setSelectedPath(root)}
            onClick={(event) => { event.currentTarget.focus(); if (roots.length > 1) void toggleDirectory(root); }}
            onDragStart={(event) => startWorkbenchPathDrag(event, root)}
            onContextMenu={(event) => openContextMenu(event, { path: root, isDirectory: true })}
          >
            {roots.length > 1
              ? <button type="button" className={`wb-file-tree-chevron${expanded ? " is-expanded" : ""}`} aria-label={expanded ? "Collapse folder" : "Expand folder"} onClick={(event) => { event.stopPropagation(); void toggleDirectory(root); }}><ThemeIcon name="chevron-right" size={ICON_SIZE.dense} /></button>
              : null}
            <ThemeIcon name="folder-open" size={ICON_SIZE.dense} color={FILE_ICON_COLORS.folder} className="wb-file-tree-icon" />
            <span className="wb-file-tree-label" title={root}>{basename(root)}</span>
          </div>
          {roots.length === 1 || expanded ? renderTree(root, 1) : null}
        </Fragment>;
      }) : <p className="muted wb-file-tree-empty">{t("desktop.workbench.sidePanelNoRoot")}</p>}
    </div>
  </>;
});
