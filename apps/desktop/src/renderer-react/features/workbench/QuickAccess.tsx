import { ThemeIcon } from "../../components/ThemeIcon";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useOverlayPresence } from "../../components/useOverlayMotion";
import {
  compareQuickAccessPathMatches,
  fuzzyMatchPath,
  matchQuickAccessPath,
  normalizeQuickAccessQuery,
  type FuzzyPathMatch
} from "../../../shared/quickAccessPathMatch";

export { fuzzyMatchPath } from "../../../shared/quickAccessPathMatch";
export type { FuzzyPathMatch } from "../../../shared/quickAccessPathMatch";

export type QuickAccessMode = "files" | "commands";

export interface QuickAccessFile {
  path: string;
  relativePath: string;
  kind?: "file" | "directory";
}

export interface QuickAccessCommand {
  id: string;
  label: string;
  detail?: string;
  keywords?: string;
  shortcut?: string;
  category?: string;
  disabledReason?: string;
  run: () => void | Promise<void>;
}

export interface QuickAccessLabels {
  filePlaceholder: string;
  commandPlaceholder: string;
  loading: string;
  noFiles: string;
  noCommands: string;
  noProject: string;
  truncated: string;
  close: string;
  dialog: string;
}

export function rankQuickAccessFiles(
  files: QuickAccessFile[],
  query: string,
  recentPaths: string[] = [],
  limit = 100
): Array<QuickAccessFile & FuzzyPathMatch> {
  const recentRank = new Map(recentPaths.map((filePath, index) => [filePath, index]));
  const needle = normalizeQuickAccessQuery(query);
  return files
    .map((file) => {
      if (!needle && file.kind === "directory") return null;
      return matchQuickAccessPath(file, query);
    })
    .filter((file): file is QuickAccessFile & FuzzyPathMatch => Boolean(file))
    .sort((a, b) => {
      if (!normalizeQuickAccessQuery(query)) {
        const aRecent = recentRank.get(a.path);
        const bRecent = recentRank.get(b.path);
        if (aRecent !== undefined || bRecent !== undefined) {
          if (aRecent === undefined) return 1;
          if (bRecent === undefined) return -1;
          return aRecent - bRecent;
        }
      }
      return compareQuickAccessPathMatches(a, b);
    })
    .slice(0, limit);
}

function highlightPath(value: string, indices: number[]): React.JSX.Element {
  const matched = new Set(indices);
  const parts: React.ReactNode[] = [];
  let current = "";
  let currentMatched = false;
  for (let index = 0; index < value.length; index += 1) {
    const nextMatched = matched.has(index);
    if (current && nextMatched !== currentMatched) {
      parts.push(currentMatched ? <mark key={parts.length}>{current}</mark> : current);
      current = "";
    }
    currentMatched = nextMatched;
    current += value[index];
  }
  if (current) parts.push(currentMatched ? <mark key={parts.length}>{current}</mark> : current);
  return <>{parts}</>;
}

function basename(filePath: string): string {
  const parts = filePath.split("/");
  return parts[parts.length - 1] || filePath;
}

function dirname(filePath: string): string {
  const index = filePath.lastIndexOf("/");
  return index > 0 ? filePath.slice(0, index) : "";
}

function optionId(kind: "file" | "command", value: string): string {
  return `quick-access-option-${kind}-${encodeURIComponent(value)}`;
}

export function QuickAccess({
  open,
  mode,
  query,
  files,
  commands,
  recentPaths,
  loading,
  truncated,
  error,
  hasProject,
  labels,
  onModeChange,
  onQueryChange,
  onClose,
  onOpenFile,
  onOpenDirectory
}: {
  open: boolean;
  mode: QuickAccessMode;
  query: string;
  files: QuickAccessFile[];
  commands: QuickAccessCommand[];
  recentPaths: string[];
  loading: boolean;
  truncated: boolean;
  error: string;
  /** Whether the palette has a workbench root to search; drives the empty state. */
  hasProject: boolean;
  labels: QuickAccessLabels;
  onModeChange: (mode: QuickAccessMode) => void;
  onQueryChange: (query: string) => void;
  onClose: () => void;
  onOpenFile: (file: QuickAccessFile) => void | Promise<void>;
  onOpenDirectory?: (directory: QuickAccessFile) => void | Promise<void>;
}): React.JSX.Element | null {
  const inputRef = useRef<HTMLInputElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const optionRefs = useRef(new Map<string, HTMLButtonElement>());
  const selectionContextRef = useRef("");
  const [selectedOptionKey, setSelectedOptionKey] = useState<string | null>(null);
  const fileResults = useMemo(
    () => rankQuickAccessFiles(files, query, recentPaths),
    [files, query, recentPaths]
  );
  const commandResults = useMemo(() => commands
    .map((command) => ({ command, match: fuzzyMatchPath(`${command.label} ${command.keywords || ""}`, query) }))
    .filter((entry): entry is { command: QuickAccessCommand; match: FuzzyPathMatch } => Boolean(entry.match))
    .sort((a, b) => b.match.score - a.match.score || a.command.label.localeCompare(b.command.label))
    .map((entry) => entry.command), [commands, query]);
  const resultOptionKeys = useMemo(() => mode === "files"
    ? fileResults.map((file) => optionId("file", file.path))
    : commandResults.map((command) => optionId("command", command.id)),
  [commandResults, fileResults, mode]);
  const resultCount = resultOptionKeys.length;
  const preferredOptionKey = resultOptionKeys[0] || null;
  const resultKeySignature = resultOptionKeys.join("\0");
  const selectionContext = `${mode}\0${query}`;
  const selectedResultIndex = selectedOptionKey ? resultOptionKeys.indexOf(selectedOptionKey) : -1;
  const activeIndex = selectedResultIndex >= 0 ? selectedResultIndex : resultCount ? 0 : -1;
  const activeId = activeIndex >= 0 ? resultOptionKeys[activeIndex] : undefined;

  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => {
      const input = inputRef.current;
      input?.focus();
      if (input?.value.startsWith(">")) {
        input.setSelectionRange(input.value.length, input.value.length);
      } else {
        input?.select();
      }
    });
    return () => {
      window.cancelAnimationFrame(frame);
      previousFocusRef.current?.focus();
      previousFocusRef.current = null;
    };
  }, [open]);

  useEffect(() => {
    const contextChanged = selectionContextRef.current !== selectionContext;
    selectionContextRef.current = selectionContext;
    setSelectedOptionKey((current) => {
      if (!contextChanged && current && resultOptionKeys.includes(current)) return current;
      return preferredOptionKey;
    });
  }, [preferredOptionKey, resultKeySignature, selectionContext]);
  useEffect(() => {
    if (!activeId) return;
    optionRefs.current.get(activeId)?.scrollIntoView?.({ block: "nearest" });
  }, [activeId]);

  const presence = useOverlayPresence(open);

  if (!presence.mounted) return null;
  const displayValue = mode === "commands" ? `>${query}` : query;
  const mac = typeof navigator !== "undefined" && /mac/i.test(navigator.platform);

  const activate = () => {
    if (activeIndex < 0) return;
    if (mode === "files") {
      const entry = fileResults[activeIndex];
      if (entry.kind === "directory") void onOpenDirectory?.(entry);
      else void onOpenFile(entry);
    }
    else if (!commandResults[activeIndex].disabledReason) void commandResults[activeIndex].run();
  };

  const selectResult = (index: number) => {
    setSelectedOptionKey(resultOptionKeys[index] || null);
  };

  const moveSelection = (offset: -1 | 1) => {
    if (!resultCount) return;
    if (activeIndex < 0) {
      selectResult(offset > 0 ? 0 : resultCount - 1);
      return;
    }
    selectResult((activeIndex + offset + resultCount) % resultCount);
  };

  return <div className={`quick-access-overlay${presence.closing ? " is-closing" : ""}`}>
    <button type="button" className="quick-access-backdrop" aria-label={labels.close} onClick={onClose} />
    <section className="quick-access-panel" role="dialog" aria-modal="true" aria-label={labels.dialog}>
      <div className="quick-access-input-row">
        {mode === "files" ? <ThemeIcon name="search" size={17} aria-hidden="true" /> : <ThemeIcon name="command" size={17} aria-hidden="true" />}
        <input
          ref={inputRef}
          className="quick-access-input"
          role="combobox"
          aria-expanded="true"
          aria-controls="quick-access-results"
          aria-activedescendant={activeId}
          aria-autocomplete="list"
          value={displayValue}
          placeholder={mode === "files" ? labels.filePlaceholder : labels.commandPlaceholder}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => {
            const value = event.target.value;
            if (value.startsWith(">")) {
              if (mode !== "commands") onModeChange("commands");
              onQueryChange(value.slice(1));
            } else {
              if (mode !== "files") onModeChange("files");
              onQueryChange(value);
            }
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              onClose();
            } else if (event.key === "ArrowDown") {
              event.preventDefault();
              moveSelection(1);
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              moveSelection(-1);
            } else if (event.key === "Home") {
              event.preventDefault();
              selectResult(0);
            } else if (event.key === "End") {
              event.preventDefault();
              selectResult(resultCount - 1);
            } else if (event.key === "Enter" && !event.nativeEvent.isComposing) {
              event.preventDefault();
              activate();
            }
          }}
        />
        <kbd>{mode === "files" ? (mac ? "⌘P" : "Ctrl+P") : (mac ? "⌘⇧P" : "Ctrl+Shift+P")}</kbd>
      </div>
      <div className="quick-access-results" id="quick-access-results" role="listbox">
        {mode === "files" ? <>
          {!hasProject ? <p className="quick-access-state">{labels.noProject}</p> : loading && !files.length ? <p className="quick-access-state"><ThemeIcon name="loader" className="spin" size={15} />{labels.loading}</p> : error ? <p className="quick-access-state is-error" role="alert">{error}</p> : fileResults.length ? fileResults.map((file, index) => {
            const id = optionId("file", file.path);
            const name = basename(file.relativePath);
            const directory = dirname(file.relativePath);
            const nameOffset = file.relativePath.length - name.length;
            return <button
              ref={(node) => { if (node) optionRefs.current.set(id, node); else optionRefs.current.delete(id); }}
              type="button"
              role="option"
              id={id}
              aria-selected={index === activeIndex}
              className={`quick-access-option${index === activeIndex ? " is-selected" : ""}`}
              key={file.path}
              onMouseMove={() => setSelectedOptionKey(id)}
              onClick={() => file.kind === "directory" ? void onOpenDirectory?.(file) : void onOpenFile(file)}
            >
              {file.kind === "directory" ? <ThemeIcon name="folder" size={16} aria-hidden="true" /> : <ThemeIcon name="file-code" size={16} aria-hidden="true" />}
              <span className="quick-access-option-copy"><span className="quick-access-option-label">{highlightPath(name, file.indices.filter((match) => match >= nameOffset).map((match) => match - nameOffset))}</span>{directory ? <span className="quick-access-option-detail">{highlightPath(directory, file.indices.filter((match) => match < nameOffset))}</span> : null}</span>
            </button>;
          }) : <p className="quick-access-state">{labels.noFiles}</p>}
        </> : commandResults.length ? (() => {
          let lastCategory: string | undefined = undefined;
          const showCategories = !normalizeQuickAccessQuery(query);
          return commandResults.map((command, index) => {
            const id = optionId("command", command.id);
            const disabled = Boolean(command.disabledReason);
            const categoryHeader = showCategories && command.category && command.category !== lastCategory
              ? <div key={`cat-${command.category}`} className="quick-access-section-header" role="presentation">{command.category}</div>
              : null;
            if (showCategories && command.category) lastCategory = command.category;
            return <Fragment key={command.id}>
              {categoryHeader}
              <button
                ref={(node) => { if (node) optionRefs.current.set(id, node); else optionRefs.current.delete(id); }}
                type="button"
                role="option"
                id={id}
                aria-selected={index === activeIndex}
                aria-disabled={disabled}
                className={`quick-access-option${index === activeIndex ? " is-selected" : ""}${disabled ? " is-disabled" : ""}`}
                onMouseMove={() => setSelectedOptionKey(id)}
                onClick={() => { if (!disabled) void command.run(); }}
              >
                <ThemeIcon name="command" size={16} aria-hidden="true" />
                <span className="quick-access-option-copy"><span className="quick-access-option-label">{command.label}</span>{command.disabledReason || command.detail ? <span className="quick-access-option-detail">{command.disabledReason || command.detail}</span> : null}</span>
                {command.shortcut ? <kbd>{command.shortcut}</kbd> : null}
              </button>
            </Fragment>;
          });
        })() : <p className="quick-access-state">{labels.noCommands}</p>}
      </div>
      {mode === "files" && truncated ? <div className="quick-access-limit">{labels.truncated}</div> : null}
    </section>
  </div>;
}
