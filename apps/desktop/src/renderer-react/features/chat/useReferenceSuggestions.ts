import { useCallback, useEffect, useMemo, useState } from "react";
import { desktopApi } from "../../bridge";
import { atTokenAtCursor, hashTokenAtCursor, joinDirPath } from "./chatTokens";
import { buildMentionSuggestions, useMentionSources } from "./composerMentions";

export interface ReferenceSuggestion {
  key: string;
  /** What to insert: an absolute path for both `@` and `#` on raw-text surfaces. */
  insert: string;
  label: string;
  badge: string;
  detail?: string;
  /** A directory can be stepped into with Tab/→ rather than accepted. */
  directory?: boolean;
  /** Path shown in the row's right-hand column. */
  path?: string;
}

export interface ReferenceSuggestionState {
  open: boolean;
  items: ReferenceSuggestion[];
  activeIndex: number;
  accept(index?: number): void;
  step(index?: number): void;
  move(delta: number): void;
  dismiss(): void;
}

/**
 * `@` and `#` autocomplete for a composer that types into a running agent
 * rather than compiling a prompt.
 *
 * Chat has its own richer composer — it can bind a workspace or inject a note's
 * body — but the terminal and ACP surfaces have no prompt step: whatever is
 * typed goes straight to the agent, so a reference is most useful as the
 * absolute path the agent can open itself. Same triggers, same ordering, same
 * keyboard, one implementation.
 */
export function useReferenceSuggestions(params: {
  value: string;
  cursor: number;
  /** Directory `#` browses from. */
  rootDir: string;
  /** Receives the rewritten text and where the caret belongs. */
  onInsert: (next: string, caret: number) => void;
}): ReferenceSuggestionState {
  const { value, cursor, rootDir, onInsert } = params;
  const sources = useMentionSources();
  const [dismissed, setDismissed] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [entries, setEntries] = useState<Array<{ name: string; isDirectory: boolean }>>([]);
  const [dirPath, setDirPath] = useState("");
  const [loading, setLoading] = useState(false);

  const atToken = useMemo(() => atTokenAtCursor(value, cursor), [cursor, value]);
  const hashToken = useMemo(() => hashTokenAtCursor(value, cursor), [cursor, value]);

  useEffect(() => {
    setDismissed(false);
    setActiveIndex(0);
  }, [value]);

  const listDir = hashToken?.dirPath ?? "";
  const listRoot = useMemo(() => {
    if (!hashToken) return "";
    return listDir ? joinDirPath(rootDir, listDir) : rootDir;
  }, [hashToken, listDir, rootDir]);

  useEffect(() => {
    if (!hashToken || !listRoot) {
      setEntries([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setDirPath(listDir);
    void desktopApi()
      .workbenchListDirectory({ rootPath: rootDir, dirPath: listRoot })
      .then((result) => {
        if (!cancelled) setEntries(result.entries || []);
      })
      .catch(() => {
        if (!cancelled) setEntries([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [hashToken, listDir, listRoot, rootDir]);

  const items = useMemo<ReferenceSuggestion[]>(() => {
    const query = (atToken?.query ?? hashToken?.query ?? "").toLowerCase();
    if (atToken) {
      return buildMentionSuggestions(atToken.query, sources)
        // A raw-text surface can only point at something with a path; the entity
        // itself lives in the chat surfaces.
        .filter((item) => Boolean(item.path))
        .map((item) => ({
          key: `${item.kind}:${item.id}`,
          insert: item.path as string,
          label: `@${item.title}`,
          badge: item.badge,
          detail: item.subtitle,
          path: item.path
        }));
    }
    if (!hashToken) return [];
    const base = dirPath ? joinDirPath(rootDir, dirPath) : rootDir;
    return entries
      .filter((entry) => !query || entry.name.toLowerCase().includes(query))
      .sort((a, b) => (a.isDirectory === b.isDirectory ? a.name.localeCompare(b.name) : a.isDirectory ? -1 : 1))
      .slice(0, 30)
      .map((entry) => ({
        key: `path:${entry.name}:${entry.isDirectory}`,
        insert: joinDirPath(base, entry.name),
        label: entry.name,
        badge: entry.isDirectory ? "目录" : "文件",
        directory: entry.isDirectory,
        path: joinDirPath(base, entry.name)
      }));
  }, [atToken, dirPath, entries, hashToken, rootDir, sources]);

  const open = !dismissed && items.length > 0;
  const token = atToken ?? hashToken;

  const write = useCallback(
    (insert: string, caretSuffix = " ") => {
      if (!token) return;
      const inserted = `${insert}${caretSuffix}`;
      const next = `${value.slice(0, token.start)}${inserted}${value.slice(cursor)}`;
      onInsert(next, token.start + inserted.length);
    },
    [cursor, onInsert, token, value]
  );

  const accept = useCallback(
    (index = activeIndex) => {
      const item = items[index];
      if (!item) return;
      write(item.insert);
      setDismissed(true);
    },
    [activeIndex, items, write]
  );

  /** `#` on a directory continues inside it rather than inserting it. */
  const step = useCallback(
    (index = activeIndex) => {
      const item = items[index];
      if (!item) return;
      if (!item.directory || !hashToken) {
        accept(index);
        return;
      }
      const nextPath = dirPath ? `${dirPath}/${item.label}` : item.label;
      const next = `${value.slice(0, hashToken.start)}#${nextPath}/${value.slice(cursor)}`;
      onInsert(next, hashToken.start + nextPath.length + 2);
      setDismissed(false);
    },
    [accept, activeIndex, cursor, dirPath, hashToken, items, onInsert, value]
  );

  const move = useCallback(
    (delta: number) => {
      if (!items.length) return;
      setActiveIndex((current) => (current + delta + items.length) % items.length);
    },
    [items.length]
  );

  return {
    open,
    items,
    activeIndex,
    accept,
    step,
    move,
    dismiss: () => setDismissed(true)
  };
}
