import {
  Fragment,
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent
} from "react";
import { ThemeIcon } from "../../components/ThemeIcon";
import { desktopApi } from "../../bridge";
import { splitImHashQuery, type Translate } from "./imUtils";

type DesktopApi = ReturnType<typeof desktopApi>;
type DirectoryEntry = Awaited<ReturnType<DesktopApi["workbenchListDirectory"]>>["entries"][number];
type SearchFile = Awaited<ReturnType<DesktopApi["workbenchSearchPaths"]>>["files"][number];

const SEARCH_DEBOUNCE_MS = 200;
const SEARCH_MIN_FILTER = 2;
const MAX_SEARCH_ROWS = 20;

/** Keyboard surface exposed to the composer textarea; returns true when the event is consumed. */
export interface ImFilePickerHandle {
  handleKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>): boolean;
}

export interface ImFilePickerProps {
  projectPath: string;
  /** Current `#` token query, e.g. `src/comp`. */
  query: string;
  /** Rewrites the token to `#nextQuery` (drill in / go up) and keeps browsing. */
  onNavigate: (nextQuery: string) => void;
  /** Finalizes the pick: inserts `#relativePath ` into the composer and closes. */
  onSelect: (relativePath: string) => void;
  onDismiss: () => void;
  t: Translate;
}

type Row =
  | { kind: "up" }
  | { kind: "selectDir"; dirPart: string }
  | { kind: "entry"; entry: DirectoryEntry }
  | { kind: "search"; file: SearchFile };

/**
 * `#` file/folder picker popover for the IM composer. Browses the workspace
 * level by level (`workbenchListDirectory`), drills into folders via Enter,
 * selects folders through the pinned 「select this folder」row, and appends
 * workspace-wide quick-search hits (`workbenchSearchPaths`) below the local
 * listing. Reuses the mention-menu interaction model: ↑/↓ wrap, Enter/Tab
 * accept, Escape dismiss.
 */
export const ImFilePicker = forwardRef<ImFilePickerHandle, ImFilePickerProps>(function ImFilePicker({
  projectPath,
  query,
  onNavigate,
  onSelect,
  onDismiss,
  t
}, ref) {
  const { dirPart, filter } = useMemo(() => splitImHashQuery(query), [query]);
  const [entries, setEntries] = useState<DirectoryEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [searchFiles, setSearchFiles] = useState<SearchFile[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<HTMLDivElement | null>(null);
  const rowRefs = useRef<Array<HTMLButtonElement | null>>([]);
  /** Per-directory listing cache so back/forward navigation is instant. */
  const entryCache = useRef(new Map<string, DirectoryEntry[]>());

  useEffect(() => {
    setEntries(null);
    setError("");
    setActiveIndex(0);
  }, [dirPart, projectPath]);

  useEffect(() => {
    let cancelled = false;
    const cached = entryCache.current.get(`${projectPath}\n${dirPart}`);
    if (cached) {
      setEntries(cached);
      setLoading(false);
      return () => {
        cancelled = true;
      };
    }
    setLoading(true);
    // dirPart always ends with "/"; strip it so dirPath stays a plain path.
    void desktopApi().workbenchListDirectory({
      rootPath: projectPath,
      dirPath: dirPart ? `${projectPath}/${dirPart.slice(0, -1)}` : projectPath
    })
      .then(({ entries: next }) => {
        if (cancelled) return;
        entryCache.current.set(`${projectPath}\n${dirPart}`, next);
        setEntries(next);
        setError("");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [dirPart, projectPath]);

  const filteredEntries = useMemo(() => {
    if (!entries) return [];
    const needle = filter.toLowerCase();
    const matched = needle
      ? entries.filter((entry) => entry.name.toLowerCase().includes(needle))
      : entries;
    // Directories first, then prefix matches before substring matches.
    return [...matched].sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      const ap = needle && a.name.toLowerCase().startsWith(needle);
      const bp = needle && b.name.toLowerCase().startsWith(needle);
      if (ap !== bp) return ap ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    });
  }, [entries, filter]);

  // Workspace-wide quick search, debounced; only while a filter is typed.
  useEffect(() => {
    if (filter.trim().length < SEARCH_MIN_FILTER) {
      setSearchFiles([]);
      return;
    }
    let sequence = 0;
    const timer = window.setTimeout(() => {
      const api = desktopApi();
      const request = ++sequence;
      void api.workbenchSearchPaths({ rootPath: projectPath, query })
        .then((result) => {
          if (request !== sequence) return;
          setSearchFiles(result.files);
        })
        .catch(() => {
          if (request !== sequence) return;
          setSearchFiles([]);
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      sequence += 1;
      window.clearTimeout(timer);
    };
  }, [filter, projectPath, query]);

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    if (dirPart) {
      out.push({ kind: "up" });
      out.push({ kind: "selectDir", dirPart });
    }
    for (const entry of filteredEntries) out.push({ kind: "entry", entry });
    const localPaths = new Set(filteredEntries.map((entry) => entry.path));
    for (const file of searchFiles) {
      if (localPaths.has(file.path)) continue;
      if (out.length >= MAX_SEARCH_ROWS + (dirPart ? 2 : 0)) break;
      out.push({ kind: "search", file });
    }
    return out;
  }, [dirPart, filteredEntries, searchFiles]);

  useEffect(() => {
    setActiveIndex((current) => (rows.length ? Math.min(current, rows.length - 1) : 0));
  }, [rows.length]);

  useEffect(() => {
    if (!rows.length) return;
    const frame = requestAnimationFrame(() => {
      const row = rowRefs.current[activeIndex];
      if (row && listRef.current?.contains(row) && typeof row.scrollIntoView === "function") {
        row.scrollIntoView({ block: "nearest" });
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [activeIndex, rows.length]);

  const activateRow = (row: Row | undefined): void => {
    if (!row) return;
    if (row.kind === "up") {
      const parent = dirPart.slice(0, dirPart.length - 1).lastIndexOf("/");
      onNavigate(parent < 0 ? "" : dirPart.slice(0, parent + 1));
      return;
    }
    if (row.kind === "selectDir") {
      onSelect(row.dirPart);
      return;
    }
    if (row.kind === "entry") {
      if (row.entry.isDirectory) onNavigate(`${dirPart}${row.entry.name}/`);
      else onSelect(`${dirPart}${row.entry.name}`);
      return;
    }
    onSelect(row.file.relativePath);
  };

  useImperativeHandle(ref, () => ({
    handleKeyDown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        onDismiss();
        return true;
      }
      if (!rows.length) return false;
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIndex((current) => (current + 1) % rows.length);
        return true;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex((current) => (current - 1 + rows.length) % rows.length);
        return true;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        activateRow(rows[activeIndex] ?? rows[0]);
        return true;
      }
      return false;
    }
  }));

  let searchHeaderRendered = false;

  return (
    <div
      ref={listRef}
      className="im-file-picker"
      role="listbox"
      aria-label={t("desktop.im.filePickerLabel")}
      aria-activedescendant={rows.length ? `im-file-picker-row-${activeIndex}` : undefined}
    >
      {loading ? (
        <div className="im-file-picker-state" role="option" aria-disabled="true">{t("desktop.im.filePickerLoading")}</div>
      ) : error ? (
        <div className="im-file-picker-state" role="option" aria-disabled="true">{t("desktop.im.filePickerError", error)}</div>
      ) : !rows.length ? (
        <div className="im-file-picker-state" role="option" aria-disabled="true">{t("desktop.im.filePickerEmpty")}</div>
      ) : rows.map((row, index) => {
        const active = index === activeIndex;
        const id = `im-file-picker-row-${index}`;
        const shared = {
          id,
          type: "button" as const,
          role: "option" as const,
          "aria-selected": active,
          className: active ? "active" : undefined,
          onMouseEnter: () => setActiveIndex(index),
          onMouseDown: (event: ReactMouseEvent<HTMLButtonElement>) => event.preventDefault(),
          onClick: () => activateRow(row)
        };
        const header = row.kind === "search" && !searchHeaderRendered
          ? (
              <div key="im-file-picker-search-header" className="im-file-picker-section">
                {t("desktop.im.filePickerSearchResults")}
              </div>
            )
          : null;
        if (row.kind === "search") searchHeaderRendered = true;
        const content = row.kind === "up" ? (
          <>
            <ThemeIcon name="corner-down-right" size={13} aria-hidden="true" />
            <span className="im-file-picker-name">../</span>
            <span className="im-file-picker-meta">{t("desktop.im.filePickerUp")}</span>
          </>
        ) : row.kind === "selectDir" ? (
          <>
            <ThemeIcon name="check" size={13} aria-hidden="true" />
            <span className="im-file-picker-name">#{row.dirPart}</span>
            <span className="im-file-picker-meta">{t("desktop.im.filePickerSelectDir")}</span>
          </>
        ) : row.kind === "entry" ? (
          <>
            <ThemeIcon
              name={row.entry.isDirectory ? "folder" : "file-text"}
              size={13}
              aria-hidden="true"
              className="im-file-picker-entry-icon"
              data-directory={row.entry.isDirectory ? "true" : "false"}
            />
            <span className="im-file-picker-name">{row.entry.name}{row.entry.isDirectory ? "/" : ""}</span>
          </>
        ) : (
          <>
            <ThemeIcon
              name={row.file.kind === "directory" ? "folder" : "file-text"}
              size={13}
              aria-hidden="true"
              className="im-file-picker-entry-icon"
              data-directory={row.file.kind === "directory" ? "true" : "false"}
            />
            <span className="im-file-picker-name">{row.file.relativePath}</span>
          </>
        );
        return header ? (
          <Fragment key={id}>
            {header}
            <button ref={(element) => { rowRefs.current[index] = element; }} {...shared}>{content}</button>
          </Fragment>
        ) : (
          <button key={id} ref={(element) => { rowRefs.current[index] = element; }} {...shared}>{content}</button>
        );
      })}
    </div>
  );
});
