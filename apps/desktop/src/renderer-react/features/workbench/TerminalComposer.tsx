import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { ThemeIcon } from "../../components/ThemeIcon";
import { desktopApi } from "../../bridge";
import { useI18n } from "../../i18n";
import {
  hasWorkbenchPathDnd,
  shellQuotePath,
  WB_PATH_DND_MIME
} from "./workbenchDnd";
import {
  loadTerminalComposerHistory,
  loadTerminalComposerPosition,
  pushTerminalComposerHistory,
  saveTerminalComposerPosition
} from "./terminalComposerHistory";

/** The composer only needs these fields of the module-local TerminalPane. */
export type TerminalComposerPane = {
  key: string;
  cwd: string;
  group: "session" | "terminal";
};

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
 * Custom primary input for agent/TUI session panes. Sends a full line to the
 * PTY on Enter; Shift+Enter inserts a newline; the terminal remains clickable
 * for raw-key input. Collapses to a slim hint strip when the terminal has
 * focus (zero permanent space cost).
 */
export function TerminalComposer(props: {
  pane: TerminalComposerPane;
  ptyId: number | null;
  active: boolean;
  registerFocus: (key: string, focus: () => void) => () => void;
}): React.JSX.Element {
  const { pane, ptyId, active, registerFocus } = props;
  const { t } = useI18n();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const [value, setValue] = useState("");
  const [rows, setRows] = useState(1);
  const [focused, setFocused] = useState(false);
  const [history, setHistory] = useState<string[]>(() => loadTerminalComposerHistory(pane.cwd));
  /** -1 = not browsing; 0 = most recent. */
  const [historyIndex, setHistoryIndex] = useState(-1);
  const draftRef = useRef("");
  const [suggestionsDismissed, setSuggestionsDismissed] = useState(false);
  const [activeSuggestion, setActiveSuggestion] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const dragDepth = useRef(0);
  const [position, setPosition] = useState(() => loadTerminalComposerPosition(pane.cwd));
  const positionRef = useRef(position);
  useEffect(() => {
    positionRef.current = position;
  }, [position]);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  } | null>(null);

  const disabled = ptyId === null || !active;

  const suggestions = useMemo(() => computeSuggestions(value, history), [value, history]);
  const suggestionsOpen = focused && !disabled && suggestions.length > 0 && !suggestionsDismissed;

  // Keep the collapsed state when the pane (or workbench tab) goes inactive.
  useEffect(() => {
    if (!active) setFocused(false);
  }, [active]);

  // Box-primary: once the composer mounts (PTY ready) on the active pane, take
  // focus so typing lands in the box immediately. Hidden/background panes are
  // disabled and skip this — navigation there routes through focusWorkbenchPane.
  const didInitialFocusRef = useRef(false);
  useEffect(() => {
    if (didInitialFocusRef.current) return;
    if (disabled) return;
    didInitialFocusRef.current = true;
    const el = inputRef.current;
    if (el) {
      el.focus();
      setFocused(true);
    }
  }, [disabled]);

  // Register a focus handle for parent pane navigation; live-check disabled so
  // a not-yet-ready PTY never steals focus. Unregister on unmount.
  useEffect(
    () =>
      registerFocus(pane.key, () => {
        const el = inputRef.current;
        if (el && !el.disabled) el.focus();
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
    // Temporarily apply text so scrollHeight reflects soft wraps even when the
    // controlled value hasn't re-rendered yet (e.g. history restore).
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

  const send = useCallback(() => {
    const text = value.trim();
    if (!text || ptyId === null || !active) return;
    void desktopApi().terminalInput({ id: ptyId, data: `${text}\r` });
    setHistory((current) => pushTerminalComposerHistory(pane.cwd, text));
    setValue("");
    setRows(1);
    setHistoryIndex(-1);
    draftRef.current = "";
    setSuggestionsDismissed(false);
    setActiveSuggestion(0);
    inputRef.current?.focus();
  }, [active, pane.cwd, ptyId, value]);

  const acceptSuggestion = useCallback((command: string) => {
    setValue(command);
    resizeRows(command);
    setSuggestionsDismissed(true);
    setActiveSuggestion(0);
    inputRef.current?.focus();
  }, [resizeRows]);

  const onInputChange = useCallback((event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const next = event.target.value;
    setValue(next);
    resizeRows(next);
    setHistoryIndex(-1);
    draftRef.current = next;
    setSuggestionsDismissed(false);
    setActiveSuggestion(0);
  }, [resizeRows]);

  // --- Floating position drag ---

  const beginComposerDrag = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    if (disabled) return;
    event.preventDefault();
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      origX: position.x,
      origY: position.y
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }, [disabled, position.x, position.y]);

  const moveComposerDrag = useCallback((event: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const pane = composerRef.current?.closest<HTMLElement>(".wb-terminal-pane");
    const paneWidth = pane?.clientWidth || window.innerWidth;
    const paneHeight = pane?.clientHeight || window.innerHeight;
    const selfWidth = composerRef.current?.clientWidth || 0;
    const selfHeight = composerRef.current?.clientHeight || 0;
    // Reserve room for the expanded width so growing the bar never clips.
    const maxX = Math.max(4, Math.min(paneWidth - 564, paneWidth - selfWidth - 4));
    const maxY = Math.max(4, paneHeight - selfHeight - 4);
    const x = Math.min(Math.max(4, drag.origX + event.clientX - drag.startX), maxX);
    const y = Math.min(Math.max(4, drag.origY - (event.clientY - drag.startY)), maxY);
    setPosition({ x, y });
  }, []);

  const endComposerDrag = useCallback((event: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    saveTerminalComposerPosition(pane.cwd, positionRef.current);
  }, [pane.cwd]);

  const onKeyDown = useCallback((event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (disabled) return;
    const isEnter = event.key === "Enter";
    const isTab = event.key === "Tab";

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
          // Accept the highlighted suggestion; keep focus, do not send yet.
          event.preventDefault();
          acceptSuggestion(pick);
          return;
        }
        if (isEnter && pick === value) {
          // Exact match — Enter means send, not accept-loop.
          event.preventDefault();
          send();
          return;
        }
        // pick === value on Tab (or Enter without a pick): swallow to avoid a
        // focus jump while the listbox is open.
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
      send();
      return;
    }

    const plainArrow = !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey;
    // Single-line values recall history like a shell on any ↑/↓; multi-line
    // values keep native cursor movement except at the value's very edge.
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
        setValue(nextValue);
        resizeRows(nextValue);
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
        setValue(nextValue);
        resizeRows(nextValue);
        setSuggestionsDismissed(true);
        requestAnimationFrame(() => {
          const el = inputRef.current;
          if (el) el.setSelectionRange(el.value.length, el.value.length);
        });
      }
      return;
    }
  }, [acceptSuggestion, disabled, history, historyIndex, resizeRows, send, suggestions, suggestionsOpen, activeSuggestion, value]);

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
    setValue(next);
    resizeRows(next);
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
      ref={composerRef}
      className={`wb-terminal-composer${focused ? " is-expanded" : " is-collapsed"}${dragOver ? " is-drag-over" : ""}`}
      style={{ left: position.x, bottom: position.y }}
      title={t("desktop.workbench.terminalComposerHint")}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <button
        type="button"
        className="wb-terminal-composer-grip"
        aria-label={t("desktop.workbench.terminalComposerMove")}
        title={t("desktop.workbench.terminalComposerMove")}
        onPointerDown={beginComposerDrag}
        onPointerMove={moveComposerDrag}
        onPointerUp={endComposerDrag}
        onPointerCancel={endComposerDrag}
        onLostPointerCapture={endComposerDrag}
      >
        <ThemeIcon name="grip-vertical" size={14} aria-hidden="true" />
      </button>
      <textarea
        ref={inputRef}
        className="wb-terminal-composer-input"
        rows={rows}
        value={value}
        disabled={disabled}
        placeholder={t("desktop.workbench.terminalComposerPlaceholder")}
        aria-label={t("desktop.workbench.terminalComposerPlaceholder")}
        aria-autocomplete="list"
        aria-controls={suggestionsOpen ? `${listId}-suggestions` : undefined}
        aria-expanded={suggestionsOpen}
        aria-activedescendant={
          suggestionsOpen && activeSuggestion >= 0 ? `${listId}-suggestion-${activeSuggestion}` : undefined
        }
        spellCheck={false}
        enterKeyHint="send"
        onChange={onInputChange}
        onKeyDown={onKeyDown}
        onFocus={() => setFocused(true)}
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
          disabled={disabled || !value.trim()}
          onMouseDown={(event) => event.preventDefault()}
          onClick={send}
        >
          <ThemeIcon name="send" size={16} />
        </button>
      </div>
      {suggestionsOpen ? (
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
