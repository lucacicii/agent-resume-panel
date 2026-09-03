import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { ThemeIcon } from "../../components/ThemeIcon";
import { desktopApi } from "../../bridge";
import { useI18n } from "../../i18n";
import type { SessionDotStatus } from "./activeSessionDots";
import {
  hasWorkbenchPathDnd,
  shellQuotePath,
  WB_PATH_DND_MIME
} from "./workbenchDnd";
import {
  loadTerminalComposerHistory,
  pushTerminalComposerHistory
} from "./terminalComposerHistory";

/** The composer only needs these fields of the module-local TerminalPane. */
export type TerminalComposerPane = {
  key: string;
  cwd: string;
  group: "session" | "terminal";
  projectPath?: string;
};

export type ComposerSendTip = {
  id: string;
  text: string;
  createdAtMs: number;
};

export const COMPOSER_TIP_LIMIT = 24;

/** Static fallback suggestions (no LLM). History recency beats these. */
export const TERMINAL_COMPOSER_STATIC_COMMANDS = [
  "git status",
  "git diff",
  "git log --oneline",
  "git pull",
  "git push",
  "git checkout",
  "pnpm install",
  "npm test"
] as const;

const MAX_SUGGESTIONS = 6;

function hashTokenAtCursor(value: string, cursor: number): { start: number; query: string } | null {
  const before = value.slice(0, cursor);
  const start = Math.max(before.lastIndexOf(" "), before.lastIndexOf("\n"), before.lastIndexOf("\t")) + 1;
  const token = before.slice(start);
  if (!token.startsWith("#") || token.slice(1).includes("#")) return null;
  return { start, query: token.slice(1) };
}

function statusDotClass(status: SessionDotStatus): string {
  if (status === "open") return "rail-session-dot";
  return `rail-session-dot is-${status === "awaiting_user" ? "awaiting" : status}`;
}

/**
 * Prefix matches before substring matches (case-insensitive), history recency
 * before the static list, deduped by exact string.
 */
export function computeSuggestions(value: string, history: string[]): string[] {
  const query = value.trim().toLowerCase();
  if (!query) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  const consider = (command: string) => {
    const lower = command.toLowerCase();
    if (!seen.has(command) && (lower.startsWith(query) || lower.includes(query))) {
      seen.add(command);
      out.push(command);
    }
  };
  const historyPrefix = history.filter((command) => command.toLowerCase().startsWith(query));
  const historySubstring = history.filter(
    (command) => !command.toLowerCase().startsWith(query) && command.toLowerCase().includes(query)
  );
  for (const command of historyPrefix) consider(command);
  for (const command of TERMINAL_COMPOSER_STATIC_COMMANDS) {
    if (command.toLowerCase().startsWith(query)) consider(command);
  }
  for (const command of historySubstring) consider(command);
  for (const command of TERMINAL_COMPOSER_STATIC_COMMANDS) {
    if (!command.toLowerCase().startsWith(query) && command.toLowerCase().includes(query)) consider(command);
  }
  return out.slice(0, MAX_SUGGESTIONS);
}

/**
 * Floating per-session input. Enter / the send button paste into the TUI
 * without submitting; drafts stay bound to the session pane.
 */
export function TerminalComposer(props: {
  pane: TerminalComposerPane;
  ptyId: number | null;
  activePane: boolean;
  projectName: string;
  sessionTitle: string;
  status?: SessionDotStatus;
  value: string;
  onChange: (value: string) => void;
  tips?: ComposerSendTip[];
  onSendToTerminal: () => void;
  onActivate: () => void;
  onOpenTip?: (tip: ComposerSendTip) => void;
  onClose: () => void;
  registerFocus: (key: string, focus: () => void) => () => void;
}): React.JSX.Element {
  const {
    pane,
    ptyId,
    activePane,
    projectName,
    sessionTitle,
    status = "open",
    value,
    onChange,
    tips = [],
    onSendToTerminal,
    onActivate,
    onOpenTip,
    onClose,
    registerFocus
  } = props;
  const { t } = useI18n();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const listId = useId();
  const [rows, setRows] = useState(1);
  const [focused, setFocused] = useState(false);
  const [history, setHistory] = useState<string[]>(() => loadTerminalComposerHistory(pane.cwd));
  /** -1 = not browsing; 0 = most recent. */
  const [historyIndex, setHistoryIndex] = useState(-1);
  const draftRef = useRef("");
  const [suggestionsDismissed, setSuggestionsDismissed] = useState(false);
  const [activeSuggestion, setActiveSuggestion] = useState(0);
  const [cursor, setCursor] = useState(0);
  const [directories, setDirectories] = useState<string[] | null>(null);
  const [directoriesLoading, setDirectoriesLoading] = useState(false);
  const [directoriesError, setDirectoriesError] = useState("");
  const [directoriesDismissed, setDirectoriesDismissed] = useState(false);
  const directoryItemRefs = useRef<Array<HTMLLIElement | null>>([]);
  const directoryRoot = pane.projectPath || pane.cwd;
  const hashToken = useMemo(() => hashTokenAtCursor(value, cursor), [cursor, value]);
  const directorySuggestions = useMemo(() => {
    if (!hashToken || !directories) return [];
    const query = hashToken.query.toLowerCase();
    return directories
      .filter((name) => name.toLowerCase().includes(query))
      .sort((a, b) => {
        const ap = a.toLowerCase().startsWith(query);
        const bp = b.toLowerCase().startsWith(query);
        return ap !== bp ? (ap ? -1 : 1) : a.localeCompare(b, undefined, { sensitivity: "base" });
      });
  }, [directories, hashToken]);
  const [activeDirectory, setActiveDirectory] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const dragDepth = useRef(0);

  const sendDisabled = ptyId === null || !value.trim();

  const suggestions = useMemo(() => computeSuggestions(value, history), [value, history]);
  const directoryOpen = focused && Boolean(hashToken) && !directoriesDismissed;
  const suggestionsOpen = !directoryOpen && focused && suggestions.length > 0 && !suggestionsDismissed;
  const activeListId = directoryOpen ? `${listId}-directories` : suggestionsOpen ? `${listId}-suggestions` : undefined;
  const activeOptionId = directoryOpen
    ? directorySuggestions.length ? `${listId}-directory-${activeDirectory}` : undefined
    : suggestionsOpen && activeSuggestion >= 0 ? `${listId}-suggestion-${activeSuggestion}` : undefined;
  const visibleTips = tips.slice(0, COMPOSER_TIP_LIMIT);
  const statusLabel = t(
    status === "awaiting_user"
      ? "desktop.workbench.sessionDot.awaiting"
      : status === "connecting"
        ? "desktop.workbench.sessionDot.connecting"
        : status === "error"
          ? "desktop.workbench.sessionDot.error"
          : status === "running"
            ? "desktop.workbench.sessionDot.running"
            : "desktop.workbench.sessionDots"
  );

  useEffect(() => {
    setDirectories(null);
    setDirectoriesError("");
    setDirectoriesDismissed(false);
    setActiveDirectory(0);
  }, [directoryRoot]);

  useEffect(() => {
    if (!directoryOpen || !directorySuggestions.length) return;
    const frame = requestAnimationFrame(() => {
      const el = directoryItemRefs.current[activeDirectory];
      if (typeof el?.scrollIntoView === "function") {
        el.scrollIntoView({ block: "nearest" });
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [activeDirectory, directoryOpen, directorySuggestions]);

  useEffect(() => {
    if (!directoryOpen || directories !== null || directoriesError) return;
    let cancelled = false;
    setDirectoriesLoading(true);
    void desktopApi().workbenchListDirectory({ rootPath: directoryRoot, dirPath: directoryRoot })
      .then(({ entries }) => {
        if (cancelled) return;
        setDirectories(entries.filter((entry) => entry.isDirectory).map((entry) => entry.name));
      })
      .catch((error: unknown) => {
        if (!cancelled) setDirectoriesError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!cancelled) setDirectoriesLoading(false);
      });
    return () => { cancelled = true; };
  }, [directories, directoriesError, directoryOpen, directoryRoot]);

  useEffect(() => {
    if (!activePane) setFocused(false);
  }, [activePane]);

  const didInitialFocusRef = useRef(false);
  useEffect(() => {
    if (didInitialFocusRef.current) return;
    if (!activePane || ptyId === null) return;
    didInitialFocusRef.current = true;
    const el = inputRef.current;
    if (el) {
      el.focus();
      setFocused(true);
      setCursor(el.selectionStart || 0);
    }
  }, [activePane, ptyId]);

  useEffect(
    () =>
      registerFocus(pane.key, () => {
        const el = inputRef.current;
        if (el) el.focus();
      }),
    [pane.key, registerFocus]
  );

  /** Grow the textarea to fit content (newlines + soft wraps); no row cap. */
  const resizeRows = useCallback((text: string) => {
    const newlineRows = Math.max(1, text.split("\n").length);
    const el = inputRef.current;
    if (!el) {
      setRows(newlineRows);
      return;
    }
    const previous = el.value;
    if (previous !== text) el.value = text;
    el.rows = newlineRows;
    while (el.scrollHeight > el.clientHeight + 1) {
      el.rows += 1;
    }
    const nextRows = el.rows;
    if (previous !== text) el.value = previous;
    setRows(nextRows);
  }, []);

  useEffect(() => {
    resizeRows(value);
  }, [resizeRows, value]);

  const applyValue = useCallback((next: string) => {
    onChange(next);
    resizeRows(next);
  }, [onChange, resizeRows]);

  const sendToTerminal = useCallback(() => {
    const text = value.trim();
    if (!text || ptyId === null) return;
    setHistory((current) => {
      void current;
      return pushTerminalComposerHistory(pane.cwd, text);
    });
    setHistoryIndex(-1);
    draftRef.current = value;
    setSuggestionsDismissed(false);
    setDirectoriesDismissed(false);
    setActiveSuggestion(0);
    setActiveDirectory(0);
    onSendToTerminal();
    applyValue("");
    draftRef.current = "";
  }, [applyValue, onSendToTerminal, pane.cwd, ptyId, value]);

  const acceptSuggestion = useCallback((command: string) => {
    applyValue(command);
    setSuggestionsDismissed(true);
    setActiveSuggestion(0);
    inputRef.current?.focus();
  }, [applyValue]);

  const acceptDirectory = useCallback((name: string) => {
    if (!hashToken) return;
    const inserted = `#${name}`;
    const next = `${value.slice(0, hashToken.start)}${inserted}${value.slice(cursor)}`;
    const nextCursor = hashToken.start + inserted.length;
    applyValue(next);
    setCursor(nextCursor);
    setDirectoriesDismissed(true);
    setActiveDirectory(0);
    requestAnimationFrame(() => inputRef.current?.setSelectionRange(nextCursor, nextCursor));
    inputRef.current?.focus();
  }, [applyValue, cursor, hashToken, value]);

  const onInputChange = useCallback((event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const next = event.target.value;
    applyValue(next);
    setHistoryIndex(-1);
    draftRef.current = next;
    setSuggestionsDismissed(false);
    setDirectoriesDismissed(false);
    setActiveSuggestion(0);
    setActiveDirectory(0);
    setCursor(event.target.selectionStart || next.length);
  }, [applyValue]);

  const onKeyDown = useCallback((event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const isEnter = event.key === "Enter";
    const isTab = event.key === "Tab";

    if (directoryOpen) {
      if (event.key === "Escape") {
        event.preventDefault();
        setDirectoriesDismissed(true);
        return;
      }
      if (directorySuggestions.length) {
        if (event.key === "ArrowDown") {
          event.preventDefault();
          setActiveDirectory((current) => (current + 1) % directorySuggestions.length);
          return;
        }
        if (event.key === "ArrowUp") {
          event.preventDefault();
          setActiveDirectory((current) => (current - 1 + directorySuggestions.length) % directorySuggestions.length);
          return;
        }
        if (isEnter || isTab) {
          event.preventDefault();
          const pick = directorySuggestions[activeDirectory];
          if (pick) acceptDirectory(pick);
          return;
        }
      }
    }

    if (suggestionsOpen) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveSuggestion((current) => (current + 1) % suggestions.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveSuggestion((current) => (current - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setSuggestionsDismissed(true);
        return;
      }
      if (isEnter || isTab) {
        const pick = suggestions[activeSuggestion >= 0 ? activeSuggestion : 0];
        if (pick && pick !== value) {
          event.preventDefault();
          acceptSuggestion(pick);
          return;
        }
        if (isEnter && pick === value) {
          event.preventDefault();
          sendToTerminal();
          return;
        }
        event.preventDefault();
        return;
      }
    }

    if (event.key === "Escape") {
      event.preventDefault();
      inputRef.current?.blur();
      return;
    }

    if (isEnter && !event.shiftKey) {
      event.preventDefault();
      sendToTerminal();
      return;
    }

    const plainArrow = !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey;
    const inputEl = inputRef.current;
    const hasNewline = value.includes("\n");
    const atStart = hasNewline
      ? inputEl ? inputEl.selectionStart === 0 && inputEl.selectionEnd === 0 : true
      : true;
    const atEnd = hasNewline
      ? inputEl
        ? inputEl.selectionStart === value.length && inputEl.selectionEnd === value.length
        : true
      : true;
    if (event.key === "ArrowUp" && plainArrow && atStart) {
      if (history.length && historyIndex < history.length - 1) {
        event.preventDefault();
        const nextIndex = historyIndex + 1;
        if (historyIndex === -1) draftRef.current = value;
        const nextValue = history[nextIndex] || "";
        setHistoryIndex(nextIndex);
        applyValue(nextValue);
        setSuggestionsDismissed(true);
        requestAnimationFrame(() => {
          const el = inputRef.current;
          if (el) el.setSelectionRange(el.value.length, el.value.length);
        });
      }
      return;
    }
    if (event.key === "ArrowDown" && plainArrow && atEnd) {
      if (historyIndex >= 0) {
        event.preventDefault();
        const nextValue = historyIndex === 0 ? draftRef.current : history[historyIndex - 1] || "";
        setHistoryIndex(historyIndex === 0 ? -1 : historyIndex - 1);
        applyValue(nextValue);
        setSuggestionsDismissed(true);
        requestAnimationFrame(() => {
          const el = inputRef.current;
          if (el) el.setSelectionRange(el.value.length, el.value.length);
        });
      }
      return;
    }
  }, [acceptDirectory, acceptSuggestion, activeDirectory, applyValue, directoryOpen, directorySuggestions, history, historyIndex, sendToTerminal, suggestions, suggestionsOpen, activeSuggestion, value]);

  const onDragEnter = (event: React.DragEvent) => {
    if (!hasWorkbenchPathDnd(event.dataTransfer)) return;
    dragDepth.current += 1;
    setDragOver(true);
  };
  const onDragOver = (event: React.DragEvent) => {
    if (!hasWorkbenchPathDnd(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  };
  const onDragLeave = () => {
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragOver(false);
  };
  const onDrop = (event: React.DragEvent) => {
    if (!hasWorkbenchPathDnd(event.dataTransfer)) return;
    event.preventDefault();
    dragDepth.current = 0;
    setDragOver(false);
    const path = event.dataTransfer.getData(WB_PATH_DND_MIME);
    if (!path) return;
    const quoted = shellQuotePath(path);
    const el = inputRef.current;
    const start = el ? el.selectionStart ?? value.length : value.length;
    const end = el ? el.selectionEnd ?? value.length : value.length;
    const next = `${value.slice(0, start)}${quoted}${value.slice(end)}`;
    applyValue(next);
    setSuggestionsDismissed(false);
    setActiveSuggestion(0);
    requestAnimationFrame(() => {
      const input = inputRef.current;
      if (input) input.setSelectionRange(start + quoted.length, start + quoted.length);
    });
    el?.focus();
  };

  return (
    <div
      className={`wb-terminal-composer${focused ? " is-expanded" : " is-collapsed"}${activePane ? " is-active-pane" : " is-inactive-pane"}${dragOver ? " is-drag-over" : ""}`}
      data-pane-key={pane.key}
      title={t("desktop.workbench.terminalComposerHint")}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className="wb-terminal-composer-head">
        <span className="rail-session-dot-btn" data-status={status} aria-label={statusLabel} title={statusLabel}>
          <span className={statusDotClass(status)} aria-hidden="true" />
        </span>
        <span className="wb-terminal-composer-project">
          <span className="wb-terminal-composer-session-title">{sessionTitle}</span>
          {projectName ? <span className="wb-terminal-composer-project-name">{projectName}</span> : null}
        </span>
        <button
          type="button"
          className="wb-terminal-composer-close"
          aria-label={t("desktop.workbench.terminalComposerClose")}
          title={t("desktop.workbench.terminalComposerClose")}
          onMouseDown={(event) => event.preventDefault()}
          onClick={onClose}
        >
          <ThemeIcon name="close" size={13} />
        </button>
      </div>
      {visibleTips.length ? (
        <ul className="wb-terminal-composer-tips" aria-label={t("desktop.workbench.terminalComposerTips")}>
          {visibleTips.map((tip) => (
            <li key={tip.id}>
              <button
                type="button"
                className="wb-terminal-composer-tip"
                title={tip.text}
                onClick={() => onOpenTip?.(tip)}
              >
                {tip.text}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <textarea
        ref={inputRef}
        className="wb-terminal-composer-input"
        rows={rows}
        value={value}
        placeholder={t("desktop.workbench.terminalComposerPlaceholder")}
        aria-label={t("desktop.workbench.terminalComposerPlaceholder")}
        aria-autocomplete="list"
        aria-controls={activeListId}
        aria-expanded={activeListId !== undefined}
        aria-activedescendant={activeOptionId}
        spellCheck={false}
        enterKeyHint="send"
        onChange={onInputChange}
        onKeyDown={onKeyDown}
        onSelect={(event) => setCursor(event.currentTarget.selectionStart || 0)}
        onClick={(event) => setCursor(event.currentTarget.selectionStart || 0)}
        onFocus={(event) => {
          setFocused(true);
          setCursor(event.currentTarget.selectionStart || 0);
        }}
        onPointerDown={() => onActivate()}
        onBlur={() => setFocused(false)}
      />
      <div className="wb-terminal-composer-tools">
        <span className="wb-terminal-composer-hint" aria-hidden="true">
          {t("desktop.workbench.terminalComposerHintLine")}
        </span>
        <button
          type="button"
          className="wb-terminal-composer-send"
          aria-label={t("desktop.workbench.terminalComposerSend")}
          title={t("desktop.workbench.terminalComposerSend")}
          disabled={sendDisabled}
          onMouseDown={(event) => event.preventDefault()}
          onClick={sendToTerminal}
        >
          <ThemeIcon name="send" size={16} />
        </button>
      </div>
      {directoryOpen ? (
        <ul
          id={`${listId}-directories`}
          className="wb-terminal-composer-suggestions"
          role="listbox"
          aria-label={t("desktop.workbench.terminalComposerDirectorySuggestions")}
        >
          {directoriesLoading ? (
            <li className="wb-terminal-composer-suggestion" role="option" aria-disabled="true">
              <span className="wb-terminal-composer-suggestion-text">{t("desktop.workbench.terminalComposerDirectoryLoading")}</span>
            </li>
          ) : directoriesError ? (
            <li className="wb-terminal-composer-suggestion" role="option" aria-disabled="true">
              <span className="wb-terminal-composer-suggestion-text">{t("desktop.workbench.terminalComposerDirectoryError", directoriesError)}</span>
            </li>
          ) : directorySuggestions.length ? directorySuggestions.map((name, index) => (
            <li
              ref={(element) => {
                directoryItemRefs.current[index] = element;
              }}
              key={name}
              id={`${listId}-directory-${index}`}
              role="option"
              aria-selected={index === activeDirectory}
              className={`wb-terminal-composer-suggestion${index === activeDirectory ? " is-active" : ""}`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => acceptDirectory(name)}
            >
              <span className="wb-terminal-composer-suggestion-text">#{name}</span>
              <span className="wb-terminal-composer-suggestion-kbd" aria-hidden="true">↵</span>
            </li>
          )) : (
            <li className="wb-terminal-composer-suggestion" role="option" aria-disabled="true">
              <span className="wb-terminal-composer-suggestion-text">{directories && directories.length ? t("desktop.workbench.terminalComposerDirectoryNoMatch") : t("desktop.workbench.terminalComposerDirectoryEmpty")}</span>
            </li>
          )}
        </ul>
      ) : suggestionsOpen ? (
        <ul
          id={`${listId}-suggestions`}
          className="wb-terminal-composer-suggestions"
          role="listbox"
          aria-label={t("desktop.workbench.terminalComposerSuggestions")}
        >
          {suggestions.map((suggestion, index) => (
            <li
              key={suggestion}
              id={`${listId}-suggestion-${index}`}
              role="option"
              aria-selected={index === activeSuggestion}
              className={`wb-terminal-composer-suggestion${index === activeSuggestion ? " is-active" : ""}`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => acceptSuggestion(suggestion)}
            >
              <span className="wb-terminal-composer-suggestion-text">{suggestion}</span>
              <span className="wb-terminal-composer-suggestion-kbd" aria-hidden="true">↵</span>
            </li>
          ))}
        </ul>
      ) : null}
      {dragOver ? (
        <div className="wb-terminal-composer-drop-hint" aria-hidden="true">
          {t("desktop.workbench.terminalComposerDropHint")}
        </div>
      ) : null}
    </div>
  );
}
