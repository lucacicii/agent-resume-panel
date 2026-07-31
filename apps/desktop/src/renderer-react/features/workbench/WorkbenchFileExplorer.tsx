import { ThemeIcon, type ThemeIconName } from "../../components/ThemeIcon";
import {
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

type DesktopApi = ReturnType<typeof desktopApi>;
type DirectoryEntry = Awaited<ReturnType<DesktopApi["workbenchListDirectory"]>>["entries"][number];

interface ExplorerTarget {
  path: string;
  isDirectory: boolean;
}

interface ExplorerContextMenu {
  x: number;
  y: number;
  target: ExplorerTarget;
  clipboardHasFiles: boolean;
}

export interface WorkbenchFileExplorerHandle {
  refresh: () => Promise<void>;
  revealPath: (targetPath: string) => Promise<void>;
}

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
  rootPath: string;
  activePath?: string;
  onOpenFile: (path: string) => void | Promise<void>;
  onShowGitHistory?: (path: string) => void | Promise<void>;
  onError: (message: string) => void;
}>(function WorkbenchFileExplorer({ rootPath, activePath = "", onOpenFile, onShowGitHistory, onError }, ref) {
  const { t } = useI18n();
  const [directories, setDirectories] = useState<Record<string, DirectoryEntry[]>>({});
  const [openDirectories, setOpenDirectories] = useState<Set<string>>(new Set());
  const [selectedPath, setSelectedPath] = useState("");
  const [contextMenu, setContextMenu] = useState<ExplorerContextMenu | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const rootPathRef = useRef(rootPath);
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
    if (!activePath || !isPathWithin(activePath, rootPath)) return;
    const target = pathKey(activePath);
    const frame = window.requestAnimationFrame(() => {
      const row = [...document.querySelectorAll<HTMLElement>("[data-wb-entry-path]")]
        .find((element) => pathKey(element.dataset.wbEntryPath || "") === target);
      row?.scrollIntoView?.({ block: "nearest" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activePath, directories, openDirectories, rootPath]);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("blur", close);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("blur", close);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [contextMenu]);

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

  const revealPath = useCallback(async (targetPath: string): Promise<void> => {
    const targetRoot = rootPathRef.current;
    if (!targetRoot || !isPathWithin(targetPath, targetRoot)) return;
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
    if (pathKey(rootPathRef.current) !== root) return;
    const nextOpenDirectories = new Set(openDirectoriesRef.current);
    for (const directoryPath of directoriesToOpen) nextOpenDirectories.add(directoryPath);
    openDirectoriesRef.current = nextOpenDirectories;
    setOpenDirectories(nextOpenDirectories);
    focusSelectedPathRef.current = true;
    setSelectedPath(targetPath);

  }, [loadDirectory]);

  useImperativeHandle(ref, () => ({ refresh, revealPath }), [refresh, revealPath]);

  useEffect(() => {
    rootPathRef.current = rootPath;
    loadSequenceRef.current.clear();
    openDirectoriesRef.current = new Set();
    setDirectories({});
    setOpenDirectories(new Set());
    setSelectedPath("");
    setContextMenu(null);
    if (rootPath) void loadDirectory(rootPath, rootPath);
  }, [loadDirectory, rootPath]);

  useEffect(() => {
    if (!activePath || !rootPath || !isPathWithin(activePath, rootPath)) return;
    let cancelled = false;
    const targetRoot = rootPath;
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
      if (cancelled || pathKey(rootPathRef.current) !== root) return;
      setOpenDirectories((currentOpenDirectories) => {
        const next = new Set(currentOpenDirectories);
        for (const directoryPath of directoriesToOpen) next.add(directoryPath);
        openDirectoriesRef.current = next;
        return next;
      });
      setSelectedPath(activePath);
    })();

    return () => { cancelled = true; };
  }, [activePath, loadDirectory, rootPath]);

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

  const copyTarget = async (target: ExplorerTarget) => {
    if (!rootPath) return;
    setContextMenu(null);
    try {
      await desktopApi().workbenchCopyPath({ rootPath, sourcePath: target.path });
      reportStatus(t("desktop.workbench.explorerCopied", basename(target.path)));
    } catch (error) {
      onError(t("desktop.workbench.explorerCopyFailed", errorMessage(error)));
    }
  };

  const copyPathTarget = (target: ExplorerTarget) => {
    setContextMenu(null);
    try {
      desktopApi().clipboardWriteText(target.path);
      reportStatus(t("desktop.workbench.explorerPathCopied"));
    } catch (error) {
      onError(t("desktop.workbench.explorerCopyPathFailed", errorMessage(error)));
    }
  };

  const pasteTarget = async (target: ExplorerTarget) => {
    if (!rootPath) return;
    setContextMenu(null);
    const targetDirectory = target.isDirectory ? target.path : parentPath(target.path);
    try {
      const result = await desktopApi().workbenchPastePaths({ rootPath, targetDirectory });
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
    if (!rootPath) return;
    setContextMenu(null);
    try {
      await desktopApi().workbenchRevealPath({ rootPath, targetPath: target.path });
    } catch (error) {
      onError(t("desktop.workbench.sidePanelRevealFailed", errorMessage(error)));
    }
  };

  const showGitHistoryTarget = async (target: ExplorerTarget) => {
    if (target.isDirectory || !onShowGitHistory) return;
    setContextMenu(null);
    await onShowGitHistory(target.path);
  };

  const openContextMenu = (event: React.MouseEvent<HTMLElement>, target: ExplorerTarget) => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.focus();
    setSelectedPath(target.path);
    setContextMenu({ x: event.clientX, y: event.clientY, target, clipboardHasFiles: false });
    void desktopApi().workbenchClipboardHasFiles()
      .then((result) => setContextMenu((current) => current && current.target.path === target.path
        ? { ...current, clipboardHasFiles: result.hasFiles }
        : current))
      .catch(() => undefined);
  };

  const handleTreeKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
    const key = event.key.toLowerCase();
    if (key !== "c" && key !== "v") return;
    const row = (event.target as HTMLElement).closest<HTMLElement>("[data-wb-entry-path]");
    const target: ExplorerTarget = row
      ? {
          path: row.dataset.wbEntryPath || rootPath,
          isDirectory: row.dataset.wbEntryDirectory === "true"
        }
      : { path: rootPath, isDirectory: true };
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
        onFocus={() => setSelectedPath(entry.path)}
        onClick={(event) => { event.currentTarget.focus(); activate(); }}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          activate();
        }}
        onContextMenu={(event) => openContextMenu(event, entry)}
      >
        {entry.isDirectory
          ? <button type="button" className={`wb-file-tree-chevron${expanded ? " is-expanded" : ""}`} aria-label={expanded ? "Collapse folder" : "Expand folder"} onClick={(event) => { event.stopPropagation(); void toggleDirectory(entry.path); }}><ThemeIcon name="chevron-right" size={14} /></button>
          : <span className="wb-file-tree-chevron is-placeholder" />}
        {(() => {
          if (entry.isDirectory) {
            return <ThemeIcon name="folder" size={15} color="#dcb67a" className="wb-file-tree-icon" />;
          }
          const { name, color } = getFileIconComponent(entry.name);
          return <ThemeIcon name={name} size={15} color={color} className="wb-file-tree-icon" />;
        })()}
        <span className="wb-file-tree-label" title={entry.path}>{entry.name}</span>
      </div>;
      return expanded ? [row, ...renderTree(entry.path, depth + 1)] : [row];
    });

  return <>
    <div className="wb-side-pane-head">
      <span className="wb-side-pane-title">{t("desktop.workbench.sidePanelExplorer")}</span>
      {rootPath ? <button type="button" className="wb-git-action-btn" disabled={refreshing} onClick={() => void refreshManually()} aria-label={t("desktop.common.refresh")} title={t("desktop.common.refresh")}><ThemeIcon name="refresh" size={14} className={refreshing ? "spin" : undefined} /></button> : null}
    </div>
    <div className="wb-file-tree wb-explorer-file-tree" role="tree" tabIndex={0} onKeyDown={handleTreeKeyDown}>
      {rootPath ? <>
        <div
          className={`wb-file-tree-row${selectedPath === rootPath ? " is-selected" : ""}`}
          role="treeitem"
          tabIndex={0}
          data-wb-entry-path={rootPath}
          data-wb-entry-directory="true"
          aria-selected={selectedPath === rootPath}
          onFocus={() => setSelectedPath(rootPath)}
          onClick={(event) => event.currentTarget.focus()}
          onContextMenu={(event) => openContextMenu(event, { path: rootPath, isDirectory: true })}
        ><ThemeIcon name="folder-open" size={15} color="#dcb67a" className="wb-file-tree-icon" /><span className="wb-file-tree-label">{basename(rootPath)}</span></div>
        {renderTree(rootPath, 1)}
      </> : <p className="muted wb-file-tree-empty">{t("desktop.workbench.sidePanelNoRoot")}</p>}
    </div>
    {contextMenu ? <div
      className="wb-context-menu wb-explorer-context-menu"
      role="menu"
      style={{
        left: Math.max(8, Math.min(contextMenu.x, window.innerWidth - 188)),
        top: Math.max(8, Math.min(contextMenu.y, window.innerHeight - 190))
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      <button type="button" role="menuitem" onClick={() => void copyTarget(contextMenu.target)}>{t("desktop.common.copy")}</button>
      <button type="button" role="menuitem" onClick={() => copyPathTarget(contextMenu.target)}>{t("desktop.common.copyPath")}</button>
      <button type="button" role="menuitem" disabled={!contextMenu.clipboardHasFiles} onClick={() => void pasteTarget(contextMenu.target)}>{t("desktop.common.paste")}</button>
      <div className="context-menu-separator" role="separator" />
      {!contextMenu.target.isDirectory && onShowGitHistory ? <button type="button" role="menuitem" onClick={() => void showGitHistoryTarget(contextMenu.target)}>{t("desktop.workbench.explorerGitFileHistory")}</button> : null}
      <button type="button" role="menuitem" onClick={() => void revealTarget(contextMenu.target)}>{t("desktop.workbench.explorerRevealInFinder")}</button>
    </div> : null}
  </>;
});
