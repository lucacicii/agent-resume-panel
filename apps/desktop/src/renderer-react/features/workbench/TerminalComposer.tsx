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
const MAX_ROWS = 6;
const MAX_COMPOSER_IMAGES = 4;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/** A pasted/dropped image staged in the composer before send. */
export type PendingComposerImage = {
  id: string;
  name: string;
  mimeType: string;
  dataUrl: string;
  base64: string;
  bytes: number;
};

/**
 * iTerm2 inline-image OSC (`OSC 1337;File=…`), which the terminal's ImageAddon
 * renders as an inline picture and the agent CLI receives as image input.
 */
export function inlineImageOsc(image: PendingComposerImage): string {
  const args = [
    `name=${encodeURIComponent(image.name || "image")}`,
    `size=${image.bytes}`,
    "inline=1",
    "preserveAspectRatio=1"
  ].join(";");
  return `\x1b]1337;File=${args}:${image.base64}\x07`;
}

function readImageFile(file: File): Promise<PendingComposerImage | null> {
  return new Promise((resolve) => {
    if (!file.type.startsWith("image/") || file.size > MAX_IMAGE_BYTES) {
      resolve(null);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || "");
      const comma = dataUrl.indexOf(",");
      const base64 = comma >= 0 ? dataUrl.slice(comma + 1) : "";
      if (!base64) {
        resolve(null);
        return;
      }
      resolve({
        id: crypto.randomUUID(),
        name: file.name || "image",
        mimeType: file.type,
        dataUrl,
        base64,
        bytes: file.size
      });
    };
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

/**
 * Extract image Files from a paste's clipboard data. Handles both a direct
 * `image/*` item and a copied file item (`kind: "file"`) whose File resolves to
 * an image mime — the latter is what Finder-style image copies produce.
 */
function imageFilesFromClipboard(clipboardData: Pick<DataTransfer, "items" | "files"> | null | undefined): File[] {
  if (!clipboardData) return [];
  const files: File[] = [];
  const push = (file: File | null | undefined) => {
    if (file && file.type.startsWith("image/") && !files.includes(file)) files.push(file);
  };
  for (const item of Array.from(clipboardData.items ?? [])) {
    if (item.type.startsWith("image/") || item.kind === "file") push(item.getAsFile());
  }
  for (const file of Array.from(clipboardData.files ?? [])) push(file);
  return files;
}

const RENDERABLE_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

/**
 * Pick a single image from a paste's files. Screenshot tools (WeChat, macOS
 * Shift+Cmd+4) expose several representations of the same capture (PNG + TIFF,
 * or an image item + a file item); a single paste should stage exactly one.
 * Prefers a renderable raster; falls back to the first image.
 */
function primaryImageFile(files: File[]): File | null {
  if (!files.length) return null;
  return files.find((file) => RENDERABLE_IMAGE_TYPES.has(file.type)) || files[0] || null;
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
  const [imageDragOver, setImageDragOver] = useState(false);
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
  const [pendingImages, setPendingImages] = useState<PendingComposerImage[]>([]);
  /** Guards against a re-delivered paste of the same image within a short window. */
  const lastImagePasteRef = useRef<{ at: number; signature: string } | null>(null);

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

  const resizeRows = useCallback((text: string) => {
    setRows(Math.min(MAX_ROWS, Math.max(1, text.split("\n").length)));
  }, []);

  const send = useCallback(() => {
    const text = value.trim();
    if (ptyId === null || !active) return;
    if (!text && pendingImages.length === 0) return;
    let data = "";
    for (const image of pendingImages) {
      data += inlineImageOsc(image);
    }
    if (text) {
      data += `${text}\r`;
    } else if (pendingImages.length) {
      data += "\r";
    }
    void desktopApi().terminalInput({ id: ptyId, data });
    setHistory((current) => text ? pushTerminalComposerHistory(pane.cwd, text) : current);
    setValue("");
    setRows(1);
    setHistoryIndex(-1);
    draftRef.current = "";
    setPendingImages([]);
    setSuggestionsDismissed(false);
    setActiveSuggestion(0);
    inputRef.current?.focus();
  }, [active, pane.cwd, pendingImages, ptyId, value]);

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

  const addPendingImages = useCallback(async (files: FileList | File[] | null) => {
    if (!files || !("length" in files) || !files.length) return;
    const staged: PendingComposerImage[] = [];
    for (const file of Array.from(files as ArrayLike<File>)) {
      const image = await readImageFile(file);
      if (image) staged.push(image);
    }
    if (!staged.length) return;
    setPendingImages((current) => {
      const room = Math.max(0, MAX_COMPOSER_IMAGES - current.length);
      const fresh = staged.filter(
        (image) =>
          !current.some(
            (existing) =>
              existing.name === image.name && existing.bytes === image.bytes && existing.mimeType === image.mimeType
          )
      );
      return [...current, ...fresh.slice(0, room)];
    });
  }, []);

  const removeImage = useCallback((id: string) => {
    setPendingImages((current) => current.filter((image) => image.id !== id));
  }, []);

  const onPaste = useCallback((event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const file = primaryImageFile(imageFilesFromClipboard(event.clipboardData));
    if (!file) return;
    event.preventDefault();
    void addPendingImages([file]);
  }, [addPendingImages]);

  // Box-primary image paste: when a session pane is active, catch image pastes
  // at the window (capture phase) even when focus is on the terminal itself —
  // otherwise xterm pastes the image's text/base64 straight into the PTY.
  // Text pastes pass through untouched; pastes aimed at other inputs are left
  // alone. Focus is moved to the composer only AFTER the paste event settles
  // (rAF): focusing synchronously inside a paste handler makes Chromium/Electron
  // re-deliver the paste to the newly focused element, looping forever.
  useEffect(() => {
    if (disabled) return;
    const onWindowPaste = (event: ClipboardEvent) => {
      const files = imageFilesFromClipboard(event.clipboardData);
      if (!files.length) return;
      const target = event.target as HTMLElement | null;
      const isComposerTarget = target === inputRef.current;
      const isTerminalTarget = Boolean(target?.closest(".wb-terminal-host"));
      if (!isComposerTarget && !isTerminalTarget) return;
      // Cooldown: a browser/Electron re-delivery of the same paste (same image
      // set within ~1s) must not re-enter staging/focus.
      const signature = files.map((file) => `${file.name}:${file.size}:${file.type}`).join("|");
      const now = Date.now();
      if (lastImagePasteRef.current) {
        const previous = lastImagePasteRef.current;
        if (previous.signature === signature && now - previous.at < 1000) return;
      }
      lastImagePasteRef.current = { at: now, signature };
      event.preventDefault();
      event.stopPropagation();
      requestAnimationFrame(() => {
        if (inputRef.current) {
          inputRef.current.focus();
          setFocused(true);
        }
      });
      void addPendingImages(files);
    };
    window.addEventListener("paste", onWindowPaste, true);
    return () => window.removeEventListener("paste", onWindowPaste, true);
  }, [addPendingImages, disabled]);

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
        setHistoryIndex(nextIndex);
        setValue(history[nextIndex] || "");
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
        if (historyIndex === 0) {
          setHistoryIndex(-1);
          setValue(draftRef.current);
        } else {
          setHistoryIndex(historyIndex - 1);
          setValue(history[historyIndex - 1] || "");
        }
        setSuggestionsDismissed(true);
        requestAnimationFrame(() => {
          const el = inputRef.current;
          if (el) el.setSelectionRange(el.value.length, el.value.length);
        });
      }
      return;
    }
  }, [acceptSuggestion, disabled, history, historyIndex, send, suggestions, suggestionsOpen, activeSuggestion, value]);

  const hasImageFiles = (event: React.DragEvent) =>
    [...(event.dataTransfer?.files ?? [])].some((file) => file.type.startsWith("image/"));

  const onDragEnter = (event: React.DragEvent) => {
    const hasPath = hasWorkbenchPathDnd(event.dataTransfer);
    if (!hasPath && !hasImageFiles(event)) return;
    dragDepth.current += 1;
    setDragOver(hasPath);
    setImageDragOver(!hasPath && hasImageFiles(event));
  };
  const onDragOver = (event: React.DragEvent) => {
    const hasPath = hasWorkbenchPathDnd(event.dataTransfer);
    const hasImage = hasImageFiles(event);
    if (!hasPath && !hasImage) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setDragOver(hasPath);
    setImageDragOver(!hasPath && hasImage);
  };
  const onDragLeave = () => {
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) {
      setDragOver(false);
      setImageDragOver(false);
    }
  };
  const onDrop = (event: React.DragEvent) => {
    event.preventDefault();
    dragDepth.current = 0;
    setDragOver(false);
    setImageDragOver(false);
    // Workbench path drag → insert the quoted path at the textarea cursor.
    if (hasWorkbenchPathDnd(event.dataTransfer)) {
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
      return;
    }
    // Image file drop → stage as pending attachments.
    const files = event.dataTransfer?.files;
    if (files && files.length && hasImageFiles(event)) {
      void addPendingImages(files);
      inputRef.current?.focus();
    }
  };

  return (
    <div
      ref={composerRef}
      className={`wb-terminal-composer${focused ? " is-expanded" : " is-collapsed"}${dragOver ? " is-drag-over" : ""}${imageDragOver ? " is-image-drag" : ""}`}
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
        onPaste={onPaste}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      />
      {pendingImages.length ? (
        <div className="wb-terminal-composer-images" aria-label={t("desktop.workbench.terminalComposerImages")}>
          {pendingImages.map((image) => (
            <div className="wb-terminal-composer-image" key={image.id} title={image.name}>
              <img src={image.dataUrl} alt={image.name} />
              <button
                type="button"
                className="wb-terminal-composer-image-remove"
                aria-label={t("desktop.common.close")}
                onClick={() => removeImage(image.id)}
              >
                <ThemeIcon name="close" size={12} aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
      ) : null}
      <div className="wb-terminal-composer-tools">
        <span className="wb-terminal-composer-hint" aria-hidden="true">
          {t("desktop.workbench.terminalComposerHintLine")}
        </span>
        <button
          type="button"
          className="wb-terminal-composer-send"
          aria-label={t("desktop.workbench.terminalComposerSend")}
          title={t("desktop.workbench.terminalComposerSend")}
          disabled={disabled || (!value.trim() && pendingImages.length === 0)}
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
      {imageDragOver ? (
        <div className="wb-terminal-composer-drop-hint is-image" aria-hidden="true">
          <ThemeIcon name="image" size={13} aria-hidden="true" />
          {t("desktop.workbench.terminalComposerImageDrop")}
        </div>
      ) : null}
    </div>
  );
}
