import { parseDiffFromFile, type CodeViewLineSelection, type SelectedLineRange } from "@pierre/diffs";
import { CodeView, type CodeViewHandle, type CodeViewItem } from "@pierre/diffs/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ThemeIcon } from "../../components/ThemeIcon";
import { desktopApi } from "../../bridge";
import { useI18n } from "../../i18n";
import type { CodeMirrorAppearance } from "../../components/codeMirrorThemes";

export type WorkbenchDiffSource = "working-tree" | "staged" | "untracked" | "commit";

export type WorkbenchDiffPane = {
  key: string;
  path: string;
  oldLabel: string;
  newLabel: string;
  oldText: string;
  newText: string;
  source: WorkbenchDiffSource;
  repoRoot: string;
  repoPath: string;
};

export type WorkbenchDiffHunkTarget = {
  key?: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
};

type DiffSearchMatch = {
  side: "old" | "new";
  from: number;
  to: number;
};

type DiffSearchMatchWithLine = DiffSearchMatch & { line: number };
type FindResult = { current: number; total: number };
type DiffViewMode = "split" | "unified";

function diffItemVersion(diff: WorkbenchDiffPane): number {
  let hash = 2166136261;
  for (const value of [diff.key, diff.path, diff.oldLabel, diff.newLabel, diff.oldText, diff.newText]) {
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    hash ^= 255;
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function collectDiffSearchMatches(oldText: string, newText: string, query: string): DiffSearchMatch[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [];
  const matches: DiffSearchMatch[] = [];
  for (const [side, text] of [["old", oldText], ["new", newText]] as const) {
    const haystack = text.toLocaleLowerCase();
    let from = 0;
    while (from <= haystack.length - needle.length) {
      const match = haystack.indexOf(needle, from);
      if (match < 0) break;
      matches.push({ side, from: match, to: match + needle.length });
      from = match + Math.max(1, needle.length);
    }
  }
  return matches;
}

export function findDiffSearchMatchIndex(
  matches: DiffSearchMatch[],
  side: DiffSearchMatch["side"],
  from: number,
  to: number
): number {
  return matches.findIndex((match) => match.side === side && match.from === from && match.to === to);
}

export function advanceDiffSearchMatchIndex(
  currentIndex: number,
  matchCount: number,
  direction: "forward" | "backward"
): number {
  if (matchCount <= 0) return -1;
  return direction === "forward"
    ? (currentIndex + 1 + matchCount) % matchCount
    : (currentIndex - 1 + matchCount) % matchCount;
}

function lineNumberAtOffset(text: string, offset: number): number {
  let line = 1;
  for (let index = 0; index < offset; index += 1) {
    if (text[index] === "\n") line += 1;
  }
  return line;
}

function matchesWithLines(oldText: string, newText: string, query: string): DiffSearchMatchWithLine[] {
  return collectDiffSearchMatches(oldText, newText, query).map((match) => ({
    ...match,
    line: lineNumberAtOffset(match.side === "old" ? oldText : newText, match.from)
  }));
}

function lineOverlapsHunk(range: SelectedLineRange, start: number, count: number): boolean {
  const end = start + Math.max(1, count) - 1;
  return range.start <= end && range.end >= start;
}

function hunkForSelection(
  fileDiff: ReturnType<typeof parseDiffFromFile>,
  selection: CodeViewLineSelection | null
): WorkbenchDiffHunkTarget | null {
  if (!selection) return null;
  const range = selection.range;
  const side = range.side || range.endSide || "additions";
  const candidates = fileDiff.hunks.filter((hunk) => lineOverlapsHunk(
    range,
    side === "deletions" ? hunk.deletionStart : hunk.additionStart,
    side === "deletions" ? hunk.deletionCount : hunk.additionCount
  ));
  if (candidates.length !== 1) return null;
  const hunk = candidates[0];
  return {
    oldStart: hunk.deletionStart,
    oldLines: hunk.deletionCount,
    newStart: hunk.additionStart,
    newLines: hunk.additionCount
  };
}

function resolveThemeType(appearance: CodeMirrorAppearance): "light" | "dark" {
  if (appearance === "light" || appearance === "dark") return appearance;
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

function toFileContents(name: string, contents: string, cacheKey: string) {
  return { name, contents, cacheKey };
}

export function WorkbenchDiffView({
  diff,
  appearance,
  onDiscardHunk
}: {
  diff: WorkbenchDiffPane;
  appearance: CodeMirrorAppearance;
  onDiscardHunk?: (target: WorkbenchDiffHunkTarget) => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const codeViewRef = useRef<CodeViewHandle<undefined> | null>(null);
  const [viewMode, setViewMode] = useState<DiffViewMode>("split");
  const [selectedLines, setSelectedLines] = useState<CodeViewLineSelection | null>(null);
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [findIndex, setFindIndex] = useState(-1);
  const [themeType, setThemeType] = useState(() => resolveThemeType(appearance));
  const findInputRef = useRef<HTMLInputElement | null>(null);
  const itemId = diff.key;
  const itemVersion = useMemo(
    () => diffItemVersion(diff),
    [diff.key, diff.newLabel, diff.newText, diff.oldLabel, diff.oldText, diff.path]
  );

  const oldFile = diff.oldLabel === "(empty)"
    ? null
    : toFileContents(diff.path, diff.oldText, `${itemId}:${itemVersion}:old`);
  const newFile = diff.newLabel === "(deleted)"
    ? null
    : toFileContents(diff.path, diff.newText, `${itemId}:${itemVersion}:new`);
  const fileDiff = useMemo(
    () => parseDiffFromFile(oldFile, newFile),
    [diff.key, diff.oldLabel, diff.oldText, diff.newLabel, diff.newText, diff.path]
  );
  const items = useMemo<readonly CodeViewItem[]>(() => [{
    id: itemId,
    type: "diff",
    fileDiff,
    version: itemVersion
  }], [fileDiff, itemId, itemVersion]);
  const activeSelectedLines = selectedLines?.id === itemId ? selectedLines : null;
  const selectedHunk = useMemo(() => hunkForSelection(fileDiff, activeSelectedLines), [activeSelectedLines, fileDiff]);
  const matches = useMemo(
    () => matchesWithLines(diff.oldText, diff.newText, findQuery),
    [diff.oldText, diff.newText, findQuery]
  );

  useEffect(() => {
    setSelectedLines(null);
    setFindOpen(false);
    setFindQuery("");
    setFindIndex(-1);
    setViewMode("split");
  }, [diff.key]);

  useEffect(() => {
    const applyTheme = () => setThemeType(resolveThemeType(appearance));
    applyTheme();
    window.addEventListener("agent-resume:appearance-change", applyTheme);
    const media = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: dark)") : null;
    media?.addEventListener("change", applyTheme);
    const observer = new MutationObserver(applyTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-visual-theme"] });
    return () => {
      window.removeEventListener("agent-resume:appearance-change", applyTheme);
      media?.removeEventListener("change", applyTheme);
      observer.disconnect();
    };
  }, [appearance]);

  useEffect(() => {
    if (!findOpen) return;
    window.requestAnimationFrame(() => {
      findInputRef.current?.focus();
      findInputRef.current?.select();
    });
  }, [findOpen]);

  useEffect(() => {
    setFindIndex(matches.length ? 0 : -1);
  }, [findQuery, matches.length]);

  const scrollToMatch = useCallback((index: number, nextMatches = matches): FindResult => {
    if (!nextMatches.length) {
      setFindIndex(-1);
      return { current: 0, total: 0 };
    }
    const normalized = (index + nextMatches.length) % nextMatches.length;
    const match = nextMatches[normalized];
    codeViewRef.current?.scrollTo({
      type: "line",
      id: itemId,
      lineNumber: match.line,
      side: match.side === "old" ? "deletions" : "additions",
      align: "center",
      behavior: "smooth-auto"
    });
    setFindIndex(normalized);
    return { current: normalized + 1, total: nextMatches.length };
  }, [itemId, matches]);

  const updateFindQuery = useCallback((value: string) => {
    setFindQuery(value);
    const nextMatches = matchesWithLines(diff.oldText, diff.newText, value);
    scrollToMatch(0, nextMatches);
  }, [diff.newText, diff.oldText, scrollToMatch]);

  const runFind = useCallback((direction: "forward" | "backward") => {
    const nextIndex = advanceDiffSearchMatchIndex(findIndex, matches.length, direction);
    return scrollToMatch(nextIndex);
  }, [findIndex, matches.length, scrollToMatch]);

  const closeFind = useCallback(() => {
    setFindOpen(false);
    setFindQuery("");
    setFindIndex(-1);
  }, []);

  const openFind = useCallback((readSelection: boolean) => {
    if (readSelection) {
      const selection = window.getSelection()?.toString().trim();
      if (selection) updateFindQuery(selection);
    }
    setFindOpen(true);
  }, [updateFindQuery]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const isFind = (event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "f";
      if (isFind) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        openFind(!(event.target instanceof HTMLInputElement));
        return;
      }
      if (!findOpen) return;
      if (event.key === "Enter" && !event.isComposing) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        runFind(event.shiftKey ? "backward" : "forward");
      } else if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        closeFind();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [closeFind, findOpen, openFind, runFind]);

  const canDiscardHunk = Boolean(onDiscardHunk) && diff.source !== "commit" && diff.source !== "untracked";
  const discardHunk = () => {
    if (!selectedHunk || !onDiscardHunk || !canDiscardHunk) return;
    onDiscardHunk(selectedHunk);
    setSelectedLines(null);
  };

  return <div className="wb-diff-view" onCopy={() => {
    const selected = window.getSelection()?.toString();
    if (selected) desktopApi().clipboardWriteText?.(selected);
  }}>
    <div className="wb-diff-toolbar">
      <div className="wb-diff-mode-toggle" role="group" aria-label={t("desktop.workbench.diffViewMode")}>
        <button type="button" className={`wb-diff-mode-btn${viewMode === "split" ? " active" : ""}`} aria-pressed={viewMode === "split"} onClick={() => setViewMode("split")}>{t("desktop.workbench.diffSplit")}</button>
        <button type="button" className={`wb-diff-mode-btn${viewMode === "unified" ? " active" : ""}`} aria-pressed={viewMode === "unified"} onClick={() => setViewMode("unified")}>{t("desktop.workbench.diffUnified")}</button>
      </div>
      {selectedHunk ? <span className="wb-diff-selection-status">{t("desktop.workbench.diffHunkSelected")}</span> : null}
      {canDiscardHunk && selectedHunk ? <button type="button" className="wb-git-action-btn wb-diff-discard-btn" onClick={discardHunk} aria-label={t("desktop.workbench.gitDiscardHunk")} title={t("desktop.workbench.gitDiscardHunk")}><ThemeIcon name="trash" size={14} />{t("desktop.workbench.gitDiscardHunk")}</button> : null}
      <button type="button" className="wb-diff-find-open-btn" aria-label={t("desktop.common.search")} title={t("desktop.common.search")} onClick={() => openFind(false)}><ThemeIcon name="search" size={14} /></button>
    </div>
    {findOpen ? <div className="wb-diff-find-bar app-inline-search" role="search">
      <ThemeIcon name="search" size={14} aria-hidden="true" />
      <input
        ref={findInputRef}
        className="wb-diff-find-input app-inline-search-input"
        type="text"
        value={findQuery}
        placeholder={t("desktop.common.search")}
        aria-label={t("desktop.common.search")}
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => updateFindQuery(event.target.value)}
        onPaste={(event) => {
          const value = event.clipboardData?.getData("text/plain") || desktopApi().clipboardReadText?.() || "";
          if (!value) return;
          event.preventDefault();
          updateFindQuery(value);
        }}
      />
      <span className={`wb-diff-find-count app-inline-search-meta${findQuery.trim() && !matches.length ? " is-empty" : ""}`} aria-live="polite">
        {findQuery.trim() ? t("desktop.common.findCount", matches.length ? findIndex + 1 : 0, matches.length) : ""}
      </span>
      <button type="button" className="wb-diff-find-btn app-inline-search-btn" aria-label={t("desktop.common.findPrev")} onClick={() => runFind("backward")}><ThemeIcon name="arrow-up" size={14} /></button>
      <button type="button" className="wb-diff-find-btn app-inline-search-btn" aria-label={t("desktop.common.findNext")} onClick={() => runFind("forward")}><ThemeIcon name="arrow-down" size={14} /></button>
      <button type="button" className="wb-diff-find-btn app-inline-search-btn" aria-label={t("desktop.common.closeFind")} onClick={closeFind}><ThemeIcon name="close" size={14} /></button>
    </div> : null}
    <div className="wb-diff-code-view">
      <CodeView
        key={diff.key}
        ref={codeViewRef}
        items={items}
        selectedLines={activeSelectedLines}
        onSelectedLinesChange={setSelectedLines}
        options={{
          theme: { dark: "pierre-dark", light: "pierre-light" },
          themeType,
          diffStyle: viewMode,
          overflow: "scroll",
          disableFileHeader: true,
          expandUnchanged: Boolean(findQuery.trim()),
          collapsedContextThreshold: 8,
          expansionLineCount: 3,
          lineDiffType: "word",
          lineHoverHighlight: "both",
          enableLineSelection: true,
          hunkSeparators: "line-info"
        }}
      />
    </div>
  </div>;
}
