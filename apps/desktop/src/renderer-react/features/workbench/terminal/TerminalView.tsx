import React, { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Terminal } from "@xterm/xterm";
import { CanvasAddon } from "@xterm/addon-canvas";
import { ClipboardAddon } from "@xterm/addon-clipboard";
import { FitAddon } from "@xterm/addon-fit";
import { ImageAddon } from "@xterm/addon-image";
import { SearchAddon, type ISearchOptions } from "@xterm/addon-search";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { ThemeIcon } from "../../../components/ThemeIcon";
import { useI18n } from "../../../i18n";
import { desktopApi } from "../../../bridge";
import type { DesktopAppearanceState } from "../../../themes";
import { registerTerminalSelection } from "../../../selection/terminalSelection";
import { notifyDesktop } from "../../../components/Notifications";
import {
  createOsc52ClipboardProvider,
  Utf8Base64,
  writeTerminalSelection
} from "../terminalClipboard";
import { resolveTerminalTheme, type WorkbenchTerminalThemeId } from "../terminalThemes";
import { WB_PATH_DND_MIME, hasWorkbenchPathDnd, shellQuotePath } from "../workbenchDnd";
import type { TerminalEngineType } from "./types";

type DesktopApi = ReturnType<typeof desktopApi>;
type TerminalGitInfo = Awaited<ReturnType<DesktopApi["terminalGitInfo"]>>;

export type WorkbenchPaneGroup = "session" | "terminal" | "code" | "browser";

export type TerminalPane = {
  key: string;
  title: string;
  group: Exclude<WorkbenchPaneGroup, "code" | "browser">;
  sessionKey?: string;
  projectPath: string;
  cwd: string;
  command?: string;
  initialPrompt?: string;
  ptyId?: number;
  branch?: string | null;
  repoRoot?: string | null;
  gitMode?: TerminalGitInfo["mode"];
  nestedRepos?: TerminalGitInfo["nestedRepos"];
};

export type TerminalRendererMode = "webgl" | "canvas";

function statusError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * OSC 52: allow apps (tmux, neovim, Claude Code, …) to write the system clipboard.
 * Prefer Electron's native clipboard so multi-byte UTF-8 (CJK) is not re-interpreted
 * as Latin-1, and so writes work without a user-gesture permission prompt.
 */
const writeOnlyClipboardProvider = createOsc52ClipboardProvider({
  writeText: (text) => {
    writeTerminalSelection(text, (value) => desktopApi().clipboardWriteText?.(value));
  }
});

const TERMINAL_SEARCH_DECORATIONS: NonNullable<ISearchOptions["decorations"]> = {
  matchBackground: "#515c6a",
  matchBorder: "#ffffff33",
  matchOverviewRuler: "#515c6a",
  activeMatchBackground: "#f5a623",
  activeMatchBorder: "#ffffff",
  activeMatchColorOverviewRuler: "#f5a623"
};

/**
 * Full-screen TUIs (claude code, prime agent, …) switch to the alternate screen
 * buffer, which has no xterm scrollback. They enable mouse tracking and scroll
 * their own viewport, so the waterdrop control emulates wheel bursts through the PTY.
 */
/** A small, controllable movement for an in-app TUI viewport. */
const TUI_WHEEL_STEP = 8;
const TUI_WHEEL_REPEAT_MS = 80;
const TUI_DRAG_DEAD_ZONE_PX = 8;
const TUI_DRAG_PIXELS_PER_TICK = 6;
const TUI_DRAG_MAX_TICKS = 32;
/** Wheel ticks sent by Home / End; TUIs scroll a few lines per tick. */
const TUI_WHEEL_JUMP = 400;
/** DEC private modes whose enablement makes the app own wheel scrolling. */
const TUI_MOUSE_TRACKING_MODES = new Set([1000, 1002, 1003]);
const MOUSE_TRACKING_SEQUENCE = /\x1b\[\?([0-9;]+)([hl])/g;

/**
 * Track DEC private mode 1000/1002/1003 (mouse tracking) per pty from the raw
 * PTY data stream. Full-screen TUIs enable these so they receive wheel events
 * and scroll their own viewport; the jump controls mirror that with a burst.
 */
export function trackTerminalMouseModes(id: number, chunk: string, tracking: Map<number, boolean>): void {
  const previous = tracking.get(id) ?? false;
  let next = previous;
  for (const match of chunk.matchAll(MOUSE_TRACKING_SEQUENCE)) {
    const modes = match[1].split(";").map((mode) => Number(mode));
    if (!modes.some((mode) => TUI_MOUSE_TRACKING_MODES.has(mode))) continue;
    next = match[2] === "h";
  }
  if (next !== previous) tracking.set(id, next);
}

/**
 * Inline agent TUIs (prime agent, codex, …) repaint the transcript with a
 * synchronized full-screen clear (`\x1b[?2026h … \x1b[2J … \x1b[?2026l`)
 * whenever content above the visible viewport changes or the transcript
 * shrinks (e.g. compaction). xterm keeps the viewport at the old baseY after
 * that, so the repainted content lands at the top of the screen — the terminal
 * appears to "jump to the top" mid-output. Track those redraw bursts per
 * terminal so TerminalView can re-anchor the viewport to the bottom.
 */
type TuiRedrawTracker = {
  /** Rolling tail of the previous chunk so split escape sequences are seen whole. */
  tail: string;
  /** Inside a `\x1b[?2026h` … `\x1b[?2026l` synchronized-output block. */
  inSync: boolean;
  /** A full-screen erase happened inside the block (redraw pending). */
  pending: boolean;
  /** The synchronized block closed after a pending erase (redraw complete). */
  blockClosed: boolean;
};

/** Longest tracked sequence is `\x1b[?2026h` (7 bytes); keep a bit of slack. */
const TUI_REDRAW_TAIL_LENGTH = 10;
const tuiRedrawTrackers = new WeakMap<Terminal, TuiRedrawTracker>();

export function trackTuiRedraw(chunk: string, terminal: Terminal): void {
  let tracker = tuiRedrawTrackers.get(terminal);
  if (!tracker) {
    tracker = { tail: "", inSync: false, pending: false, blockClosed: false };
    tuiRedrawTrackers.set(terminal, tracker);
  }
  const scan = tracker.tail + chunk;
  tracker.tail = scan.slice(-TUI_REDRAW_TAIL_LENGTH);
  if (scan.includes("\x1b[?2026h")) tracker.inSync = true;
  if (tracker.inSync && scan.includes("\x1b[2J")) tracker.pending = true;
  if (scan.includes("\x1b[?2026l")) {
    tracker.inSync = false;
    if (tracker.pending) tracker.blockClosed = true;
  }
}

/**
 * Re-anchor a session pane's normal-buffer viewport after the agent TUI
 * repainted the transcript from the top. `scrollToBottom` alone is not enough:
 * xterm's viewport is already at baseY, so a transcript shorter than the
 * screen renders at the top. Pull the viewport up by the trailing blank rows
 * so the transcript tail stays at the bottom of the screen.
 */
export function reanchorTuiViewport(terminal: Terminal): void {
  try {
    const buffer = terminal.buffer.active;
    if (buffer.type !== "normal") return;
    terminal.scrollToBottom();
    const rows = terminal.rows;
    let lastContent = -1;
    for (let i = rows - 1; i >= 0; i -= 1) {
      const line = buffer.getLine(buffer.viewportY + i);
      if (line && line.translateToString(true).trim()) {
        lastContent = i;
        break;
      }
    }
    if (lastContent >= 0 && lastContent < rows - 1) {
      const gap = rows - 1 - lastContent;
      // The public IBuffer typings only expose viewportY/baseY getters. Set the
      // internal Buffer field directly instead of scrollLines: a negative
      // scrollLines flips xterm's "user is scrolling" flag, which would freeze
      // follow-on output instead of staying anchored.
      const internal = (terminal as unknown as {
        _core?: { _bufferService?: { buffer?: { ydisp: number; ybase: number } } };
      })._core?._bufferService?.buffer;
      if (internal) {
        internal.ydisp = Math.max(0, internal.ybase - gap);
        terminal.refresh(0, rows - 1);
      }
    }
  } catch {
    /* terminal disposed mid-redraw */
  }
}

/**
 * Check whether the terminal viewport is anchored at or following the bottom of
 * output. For normal shells, this is viewportY >= baseY. For TUI surfaces where
 * trailing blank rows were pulled up by reanchorTuiViewport, this checks whether
 * the viewport sits at or below the content anchor (baseY - gap).
 */
export function isTerminalAtBottom(terminal: Terminal): boolean {
  try {
    const buffer = terminal.buffer.active;
    if (buffer.type !== "normal") return true;
    if (buffer.viewportY >= buffer.baseY) return true;
    const rows = terminal.rows;
    let lastContent = -1;
    for (let i = rows - 1; i >= 0; i -= 1) {
      const line = buffer.getLine(buffer.baseY + i);
      if (line && line.translateToString(true).trim()) {
        lastContent = i;
        break;
      }
    }
    const gap = lastContent >= 0 && lastContent < rows - 1 ? rows - 1 - lastContent : 0;
    const targetY = Math.max(0, buffer.baseY - gap);
    return buffer.viewportY >= targetY;
  } catch {
    return true;
  }
}

/**
 * Prefer WebGL for throughput; fall back to Canvas 2D, then DOM.
 * When `mode === "canvas"`, skip WebGL entirely (settings: force Canvas).
 *
 * CJK stability still depends on font stack + Unicode11 + rescaleOverlappingGlyphs.
 * On context loss (or WebGL load failure) drop to Canvas so the session stays usable.
 */
function tryLoadAcceleratedRenderer(
  terminal: Terminal,
  mode: TerminalRendererMode = "webgl"
): { dispose: () => void } {
  let active: { dispose(): void } | null = null;
  let contextLossSub: { dispose(): void } | null = null;

  const loadCanvas = (): boolean => {
    try {
      contextLossSub?.dispose();
      contextLossSub = null;
      try { active?.dispose(); } catch { /* previous renderer already gone */ }
      active = null;
      const canvas = new CanvasAddon();
      terminal.loadAddon(canvas);
      active = canvas;
      return true;
    } catch {
      active = null;
      return false;
    }
  };

  if (mode === "canvas") {
    loadCanvas();
  } else {
    try {
      const webgl = new WebglAddon();
      terminal.loadAddon(webgl);
      active = webgl;
      contextLossSub = webgl.onContextLoss(() => {
        try { webgl.dispose(); } catch { /* ignore */ }
        active = null;
        loadCanvas();
      });
    } catch {
      loadCanvas();
    }
  }

  return {
    dispose: () => {
      contextLossSub?.dispose();
      contextLossSub = null;
      try { active?.dispose(); } catch { /* ignore */ }
      active = null;
    }
  };
}

/**
 * After zoom / DPR / theme changes the WebGL glyph atlas can keep stale samples
 * (looks like scrambled CJK until hover forces a partial redraw). Rebuild atlas
 * and repaint the visible buffer.
 */
function refreshTerminalGlyphs(terminal: Terminal): void {
  try {
    terminal.clearTextureAtlas?.();
  } catch {
    /* DOM renderer has no atlas */
  }
  try {
    const last = Math.max(0, terminal.rows - 1);
    terminal.refresh(0, last);
  } catch {
    /* terminal disposed mid-fit */
  }
}

/**
 * Latin mono first (cell metrics), then CJK faces so double-width glyphs do not
 * fall back to a proportional UI font that bleeds across neighboring cells.
 */
const TERMINAL_FONT_FAMILY =
  'Menlo, Monaco, "SF Mono", Consolas, "Cascadia Mono", "Courier New", "PingFang SC", "Hiragino Sans GB", "Noto Sans Mono CJK SC", "Microsoft YaHei UI", monospace';

function resolveTransparentTerminalTheme(themeId: WorkbenchTerminalThemeId, appearance: DesktopAppearanceState) {
  // The xterm CSS parser rejects the transparent keyword and falls back to
  // its opaque default background. Use an explicit zero-alpha color instead.
  return { ...resolveTerminalTheme(themeId, appearance), background: "rgba(0, 0, 0, 0)" };
}

export const TerminalView = memo(function TerminalView({ pane, active, themeId, appearance, rendererMode, engineType = "xterm", onPty, onDetach, onInput, onInitialPromptSubmitted, mouseTracking }: {
  pane: TerminalPane;
  active: boolean;
  themeId: WorkbenchTerminalThemeId;
  appearance: DesktopAppearanceState;
  /** webgl (default) or force canvas — hot-swapped without killing the PTY. */
  rendererMode: TerminalRendererMode;
  engineType?: TerminalEngineType;
  onPty: (key: string, id: number, terminal: Terminal | null) => void;
  onDetach: (id: number) => void;
  onInput: (key: string) => void;
  onInitialPromptSubmitted: (key: string) => void;
  /** Per-pty mouse-tracking state parsed from the PTY data stream (stable ref). */
  mouseTracking: { current: Map<number, boolean> };
}): React.JSX.Element {
  const onInputRef = useRef(onInput);
  onInputRef.current = onInput;
  const onDetachRef = useRef(onDetach);
  onDetachRef.current = onDetach;
  const onPtyRef = useRef(onPty);
  onPtyRef.current = onPty;
  const onInitialPromptSubmittedRef = useRef(onInitialPromptSubmitted);
  onInitialPromptSubmittedRef.current = onInitialPromptSubmitted;
  const { t } = useI18n();
  const host = useRef<HTMLDivElement>(null);
  const scheduleFitRef = useRef<(() => void) | null>(null);
  const searchAddonRef = useRef<SearchAddon | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const rendererRef = useRef<{ dispose: () => void } | null>(null);
  const rendererModeRef = useRef<TerminalRendererMode>(rendererMode);
  const ptyId = useRef<number | null>(null);
  const initialPromptRef = useRef(pane.initialPrompt);
  initialPromptRef.current = pane.initialPrompt;
  /** Whether the user is anchored at the bottom of the normal buffer (session
   *  panes only). Updated solely from user scroll input; write-side re-anchors
   *  read it so they never fight an intentional scroll-up. */
  const followOutputRef = useRef(true);
  const [ready, setReady] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchMeta, setSearchMeta] = useState<{ index: number; count: number } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const tuiScrollTimer = useRef<number | null>(null);
  const tuiDragRef = useRef<{ pointerId: number; startY: number } | null>(null);
  const tuiScrollIntentRef = useRef<{ direction: "up" | "down"; ticks: number } | null>(null);
  const [tuiPull, setTuiPull] = useState<{ direction: "idle" | "up" | "down"; strength: number }>({ direction: "idle", strength: 0 });
  const [scrollState, setScrollState] = useState({ tuiMode: false, tuiInteractive: false });

  const runSearch = useCallback((direction: "next" | "prev", term: string) => {
    const addon = searchAddonRef.current;
    if (!addon) return;
    const q = term.trim();
    if (!q) {
      addon.clearDecorations();
      setSearchMeta(null);
      return;
    }
    const opts: ISearchOptions = {
      caseSensitive: false,
      decorations: TERMINAL_SEARCH_DECORATIONS
    };
    if (direction === "next") addon.findNext(q, opts);
    else addon.findPrevious(q, opts);
  }, []);

  useEffect(() => {
    const hostEl = host.current;
    if (!hostEl) return;
    return registerTerminalSelection({
      element: hostEl,
      getSelectedText: () => terminalRef.current?.getSelection() || "",
      projectPath: pane.projectPath
    });
  }, [pane.projectPath, ready]);

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    searchAddonRef.current?.clearDecorations();
    setSearchMeta(null);
  }, []);

  useEffect(() => {
    if (!host.current) return;
    const hostEl = host.current;
    setReady(false);
    setSearchOpen(false);
    setSearchQuery("");
    setSearchMeta(null);
    ptyId.current = null;
    const terminal = new Terminal({
      allowProposedApi: true,
      cursorBlink: true,
      fontFamily: TERMINAL_FONT_FAMILY,
      fontSize: 13,
      // Keep cell metrics tight; non-zero letterSpacing skews FitAddon + CJK.
      letterSpacing: 0,
      lineHeight: 1.0,
      // Ambiguous-width / fallback glyphs otherwise spill into the next cell.
      rescaleOverlappingGlyphs: true,
      scrollback: 10_000,
      allowTransparency: true,
      theme: resolveTransparentTerminalTheme(themeId, appearance)
    });
    terminalRef.current = terminal;
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(hostEl);

    // Unicode widths must be active before any write / accelerated paint.
    const unicode11 = new Unicode11Addon();
    terminal.loadAddon(unicode11);
    terminal.unicode.activeVersion = "11";

    const initialMode = rendererModeRef.current;
    rendererRef.current = tryLoadAcceleratedRenderer(terminal, initialMode);

    terminal.loadAddon(new WebLinksAddon((_event, uri) => {
      void desktopApi().openExternalUrl(uri).catch(() => undefined);
    }));

    // Runtime ctor is (base64?, provider?); published .d.ts only documents provider.
    // Utf8Base64 avoids atob-as-Latin-1 mojibake for CJK OSC 52 payloads.
    terminal.loadAddon(new (ClipboardAddon as unknown as new (
      base64?: Utf8Base64,
      provider?: typeof writeOnlyClipboardProvider
    ) => ClipboardAddon)(new Utf8Base64(), writeOnlyClipboardProvider));

    // Selection copy (Cmd/Ctrl+C): also push Unicode text through Electron clipboard.
    // Some Chromium/Electron paths otherwise mishandle multi-byte clipboard data.
    const onCopySelection = (event: Event) => {
      const text = terminal.getSelection();
      if (!text) return;
      writeTerminalSelection(text, (value) => desktopApi().clipboardWriteText?.(value));
      const ce = event as ClipboardEvent;
      if (ce.clipboardData) {
        ce.clipboardData.setData("text/plain", text);
        ce.preventDefault();
      }
    };
    hostEl.addEventListener("copy", onCopySelection);

    terminal.loadAddon(new ImageAddon({
      storageLimit: 64,
      enableSizeReports: true,
      // SIXEL's decoder instantiates embedded WebAssembly, which is intentionally
      // blocked by the Desktop renderer CSP (`script-src 'self'`). Keep iTerm
      // image protocol support without weakening CSP via unsafe-eval.
      sixelSupport: false
    }));

    const searchAddon = new SearchAddon();
    terminal.loadAddon(searchAddon);
    searchAddonRef.current = searchAddon;
    const searchResultsSub = searchAddon.onDidChangeResults?.((event) => {
      setSearchMeta({ index: event.resultIndex, count: event.resultCount });
    });

    let alive = true;
    let lastPtySize = "";
    const syncScrollState = () => {
      if (!alive) return;
      const buffer = terminal.buffer.active;
      // Alternate-buffer activation can happen before terminalSpawn resolves.
      // Detect the buffer independently so the TUI affordance is not missed
      // during the Codex startup handshake.
      const mouseTrackingActive = ptyId.current !== null && mouseTracking.current.get(ptyId.current) === true;
      // Agent session panes are TUI surfaces even when the CLI keeps xterm's
      // normal buffer. Once their PTY exists, allow the waterdrop to send
      // wheel events; some Codex startup paths do not expose DEC mouse modes
      // in a single parseable chunk, which must not leave the control inert.
      const tuiMode = pane.group === "session" || buffer.type === "alternate";
      const tuiInteractive = tuiMode && (pane.group === "session" || mouseTrackingActive);
      const next = { tuiMode, tuiInteractive };
      setScrollState((current) => current.tuiMode === next.tuiMode && current.tuiInteractive === next.tuiInteractive ? current : next);
    };

    const resizePty = (cols: number, rows: number) => {
      if (ptyId.current === null) return;
      const sizeKey = `${cols}x${rows}`;
      if (sizeKey === lastPtySize) return;
      lastPtySize = sizeKey;
      void desktopApi().terminalResize({ id: ptyId.current, cols, rows }).catch(() => {
        if (lastPtySize === sizeKey) lastPtySize = "";
      });
    };

    // FitAddon only updates xterm cols/rows. PTY must be told separately so
    // fullscreen TUIs and shell line wrapping track window zoom / pane resize.
    const onTermResize = terminal.onResize(({ cols, rows }) => {
      resizePty(cols, rows);
    });
    followOutputRef.current = true;
    const onWriteParsed = terminal.onWriteParsed(() => {
      syncScrollState();
      if (pane.group !== "session") return;
      const buffer = terminal.buffer.active;
      if (buffer.type !== "normal") return;
      const tracker = tuiRedrawTrackers.get(terminal);
      const redrawCompleted = tracker?.pending === true && tracker?.blockClosed === true;
      if (redrawCompleted && tracker) {
        tracker.pending = false;
        tracker.blockClosed = false;
      }
      // Inline agent TUIs repaint the transcript from the top; xterm then
      // leaves the viewport at the old baseY so the content appears at the top
      // of the screen mid-output. Re-anchor the bottom for the user.
      if (!followOutputRef.current) return;
      if (redrawCompleted) {
        reanchorTuiViewport(terminal);
      } else if (buffer.viewportY < buffer.baseY) {
        terminal.scrollToBottom();
      }
    });
    const onBufferChange = terminal.buffer.onBufferChange(syncScrollState);

    let lastFitKey = "";
    const fitHost = () => {
      if (hostEl.clientWidth < 2 || hostEl.clientHeight < 2) return;
      try {
        const proposed = fitAddon.proposeDimensions();
        if (!proposed || !Number.isFinite(proposed.cols) || !Number.isFinite(proposed.rows)) return;
        if (proposed.cols === terminal.cols && proposed.rows === terminal.rows) {
          syncScrollState();
          return;
        }
        const buffer = terminal.buffer.active;
        const wasAtNormalBufferBottom = buffer.type === "normal" && buffer.viewportY === buffer.baseY;
        fitAddon.fit();
        if (wasAtNormalBufferBottom && terminal.buffer.active.type === "normal") terminal.scrollToBottom();
        // Only rebuild the WebGL glyph atlas when geometry or DPR actually changes.
        // Continuous ResizeObserver ticks would thrash clearTextureAtlas otherwise.
        const fitKey = `${terminal.cols}x${terminal.rows}@${window.devicePixelRatio || 1}`;
        if (fitKey !== lastFitKey) {
          lastFitKey = fitKey;
          refreshTerminalGlyphs(terminal);
        }
        syncScrollState();
      } catch {
        /* hidden panes fit after activation */
      }
    };

    let fitFrame = 0;
    const scheduleFit = () => {
      if (fitFrame) return;
      fitFrame = window.requestAnimationFrame(() => {
        fitFrame = 0;
        fitHost();
      });
    };
    scheduleFitRef.current = scheduleFit;

    fitHost();
    syncScrollState();
    const observer = new ResizeObserver(scheduleFit);
    observer.observe(hostEl);
    // Window zoom / electron zoom-factor changes do not always re-fire RO alone.
    window.addEventListener("resize", scheduleFit);
    const viewport = window.visualViewport;
    viewport?.addEventListener("resize", scheduleFit);

    const input = terminal.onData((data) => {
      if (ptyId.current !== null) void desktopApi().terminalInput({ id: ptyId.current, data });
      onInputRef.current(pane.key);
    });
    // Wheel, scrollbar drags, and PageUp/PageDown move xterm's viewport. Track
    // whether the user stays anchored to the bottom so output re-anchoring
    // (above) never yanks them back while they are reading history. These run
    // in the bubble phase, after xterm's own handlers applied the scroll.
    const syncFollowState = () => {
      const buffer = terminal.buffer.active;
      if (buffer.type !== "normal") return;
      followOutputRef.current = buffer.viewportY >= buffer.baseY;
    };
    hostEl.addEventListener("wheel", syncFollowState);
    hostEl.addEventListener("pointerup", syncFollowState);
    hostEl.addEventListener("keyup", syncFollowState);

    const bindPty = (id: number, replay: string, sendInitialPrompt: boolean) => {
      if (!alive) return;
      ptyId.current = id;
      if (replay) terminal.write(replay);
      onPtyRef.current(pane.key, id, terminal);
      // Status attribution: main only knows the PTY, the renderer knows the
      // session (and may learn it after the pane was spawned).
      void desktopApi().terminalBindSession?.({ id, sessionKey: pane.sessionKey, cwd: pane.cwd });
      syncScrollState();
      setReady(true);
      // Re-fit after attach in case layout settled during spawn.
      scheduleFit();
      resizePty(terminal.cols, terminal.rows);
      if (sendInitialPrompt && initialPromptRef.current) {
        window.setTimeout(() => {
          const initialPrompt = initialPromptRef.current;
          if (!alive || ptyId.current !== id || !initialPrompt) return;
          void desktopApi().terminalInput({ id, data: `${initialPrompt}\r` })
            .then(() => onInitialPromptSubmittedRef.current(pane.key))
            .catch(() => undefined);
        }, 600);
      }
    };

    const persistOrBind = (id: number, replay: string, sendInitialPrompt: boolean) => {
      if (!alive) {
        // Project switch: keep the PTY on the pane and stop forwarding.
        // Close tab: onPty destroys the orphan spawn because the pane is gone.
        onPty(pane.key, id, null);
        if (typeof desktopApi().terminalDetach === "function") {
          void desktopApi().terminalDetach({ id });
        }
        return;
      }
      bindPty(id, replay, sendInitialPrompt);
    };

    const existingId = pane.ptyId;
    const attachExisting = existingId != null && typeof desktopApi().terminalAttach === "function"
      ? desktopApi().terminalAttach({ id: existingId }).then((result) => {
          if (result.ok) {
            persistOrBind(existingId, result.replay || "", false);
            return;
          }
          throw new Error("terminal attach failed");
        })
      : existingId != null
        ? Promise.resolve().then(() => persistOrBind(existingId, "", false))
        : desktopApi().terminalSpawn({
            cwd: pane.cwd,
            command: pane.command,
            cols: terminal.cols,
            rows: terminal.rows,
            sessionKey: pane.sessionKey
          }).then(async (spawned) => {
            const { id } = spawned;
            if (spawned.warnSoftLimit) {
              notifyDesktop({
                text: t("desktop.workbench.ptySoftLimit", spawned.count || spawned.softLimit || 12),
                kind: "info",
                durationMs: 5000
              });
            }
            let replay = "";
            if (typeof desktopApi().terminalAttach === "function") {
              const attached = await desktopApi().terminalAttach({ id });
              if (attached.ok) replay = attached.replay || "";
            }
            persistOrBind(id, replay, true);
          });

    void attachExisting.catch((error: unknown) => {
      if (!alive) return;
      terminal.write(`\r\n${statusError(error)}\r\n`);
      setReady(true);
    });
    return () => {
      alive = false;
      observer.disconnect();
      window.cancelAnimationFrame(fitFrame);
      if (scheduleFitRef.current === scheduleFit) scheduleFitRef.current = null;
      window.removeEventListener("resize", scheduleFit);
      viewport?.removeEventListener("resize", scheduleFit);
      hostEl.removeEventListener("copy", onCopySelection);
      hostEl.removeEventListener("wheel", syncFollowState);
      hostEl.removeEventListener("pointerup", syncFollowState);
      hostEl.removeEventListener("keyup", syncFollowState);
      if (tuiScrollTimer.current !== null) {
        window.clearInterval(tuiScrollTimer.current);
        tuiScrollTimer.current = null;
      }
      onTermResize.dispose();
      onWriteParsed.dispose();
      onBufferChange.dispose();
      input.dispose();
      searchResultsSub?.dispose();
      searchAddonRef.current = null;
      terminalRef.current = null;
      rendererRef.current?.dispose();
      rendererRef.current = null;
      const currentPtyId = ptyId.current ?? pane.ptyId ?? null;
      ptyId.current = null;
      if (currentPtyId !== null) {
        onDetachRef.current(currentPtyId);
        if (typeof desktopApi().terminalDetach === "function") {
          void desktopApi().terminalDetach({ id: currentPtyId });
        }
      }
      terminal.dispose();
    };
    // pane.ptyId is intentionally omitted: the first spawn writes it via onPty
    // and must not remount/detach the same view.
  }, [mouseTracking, pane.command, pane.cwd, pane.key, t]);

  // Keep main's session attribution in sync: a pane can be spawned before its
  // session resolves, and status is keyed by session as well as by PTY.
  useEffect(() => {
    const id = ptyId.current;
    if (id == null) return;
    void desktopApi().terminalBindSession?.({ id, sessionKey: pane.sessionKey, cwd: pane.cwd });
  }, [pane.cwd, pane.sessionKey]);

  // Hot-swap accelerated renderer when settings change — keep the same PTY/session.
  useEffect(() => {
    if (rendererModeRef.current === rendererMode) return;
    rendererModeRef.current = rendererMode;
    const terminal = terminalRef.current;
    if (!terminal) return;
    try { rendererRef.current?.dispose(); } catch { /* ignore */ }
    rendererRef.current = tryLoadAcceleratedRenderer(terminal, rendererMode);
    refreshTerminalGlyphs(terminal);
  }, [rendererMode]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    // Replace full theme object so ANSI colors do not leak from the previous preset.
    terminal.options.theme = resolveTransparentTerminalTheme(themeId, appearance);
    refreshTerminalGlyphs(terminal);
  }, [appearance, themeId]);

  useEffect(() => {
    if (!active) return;
    // Double rAF: wait until the pane is display:flex and has real metrics.
    let outer = 0;
    let inner = 0;
    outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => {
        try {
          scheduleFitRef.current?.();
        } catch { /* fit guard */ }
      });
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, [active]);

  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const isFind = (event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "f";
      if (isFind) {
        const terminalWrap = host.current?.closest(".wb-session-split-tui") || host.current;
        const isTerminalTarget = Boolean(
          terminalWrap && (
            terminalWrap.contains(document.activeElement) ||
            (typeof terminalWrap.matches === "function" && (
              terminalWrap.matches(":hover") ||
              terminalWrap.matches(":focus-within")
            ))
          )
        );
        if (isTerminalTarget) {
          event.preventDefault();
          event.stopPropagation();
          setSearchOpen(true);
          requestAnimationFrame(() => searchInputRef.current?.focus());
          return;
        }
        return;
      }
      if (event.key === "Escape" && searchOpen) {
        event.preventDefault();
        closeSearch();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [active, closeSearch, searchOpen]);

  useEffect(() => {
    if (!searchOpen) return;
    requestAnimationFrame(() => searchInputRef.current?.focus());
  }, [searchOpen]);

  // Accept only internal Workbench path drags. On drop, write the POSIX
  // single-quote escaped absolute path to the current PTY without any trailing
  // space, newline, or Enter, so it lands at the shell prompt or the active
  // TUI input position without executing.
  useEffect(() => {
    const hostEl = host.current;
    if (!hostEl) return;
    let dragDepth = 0;
    const onDragEnter = (event: DragEvent) => {
      if (!hasWorkbenchPathDnd(event.dataTransfer)) return;
      dragDepth += 1;
      setDragOver(true);
    };
    const onDragOver = (event: DragEvent) => {
      if (!hasWorkbenchPathDnd(event.dataTransfer)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    };
    const onDragLeave = () => {
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) setDragOver(false);
    };
    const onDrop = (event: DragEvent) => {
      if (!hasWorkbenchPathDnd(event.dataTransfer)) return;
      event.preventDefault();
      dragDepth = 0;
      setDragOver(false);
      const path = event.dataTransfer?.getData(WB_PATH_DND_MIME) || "";
      const id = ptyId.current;
      if (!path || id === null) return;
      void desktopApi().terminalInput({ id, data: shellQuotePath(path) });
      terminalRef.current?.focus();
    };
    hostEl.addEventListener("dragenter", onDragEnter);
    hostEl.addEventListener("dragover", onDragOver);
    hostEl.addEventListener("dragleave", onDragLeave);
    hostEl.addEventListener("drop", onDrop);
    return () => {
      hostEl.removeEventListener("dragenter", onDragEnter);
      hostEl.removeEventListener("dragover", onDragOver);
      hostEl.removeEventListener("dragleave", onDragLeave);
      hostEl.removeEventListener("drop", onDrop);
    };
  }, []);

  const tuiControlVisible = pane.group === "session" || scrollState.tuiMode;

  const sendTuiWheel = (direction: "up" | "down", ticks: number) => {
    const hostEl = host.current;
    if (!hostEl || ticks <= 0) return;
    // Send real wheel events through xterm instead of assuming SGR mouse
    // encoding. xterm translates each event using the active TUI protocol
    // (SGR/default/pixel), or scrolls its own normal buffer when appropriate.
    const target = hostEl.querySelector<HTMLElement>(".xterm-viewport")
      || hostEl.querySelector<HTMLElement>(".xterm")
      || hostEl;
    const screen = hostEl.querySelector<HTMLElement>(".xterm-screen");
    const rect = (screen || target).getBoundingClientRect();
    const deltaY = direction === "up" ? -1 : 1;
    for (let index = 0; index < ticks; index += 1) {
      target.dispatchEvent(new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
        deltaMode: WheelEvent.DOM_DELTA_LINE,
        deltaY
      }));
    }
  };

  const stopTuiScroll = (resetShape = true) => {
    if (tuiScrollTimer.current !== null) {
      window.clearInterval(tuiScrollTimer.current);
      tuiScrollTimer.current = null;
    }
    tuiDragRef.current = null;
    tuiScrollIntentRef.current = null;
    if (resetShape) setTuiPull({ direction: "idle", strength: 0 });
  };

  useEffect(() => {
    if (!scrollState.tuiMode || !scrollState.tuiInteractive) stopTuiScroll();
  }, [scrollState.tuiInteractive, scrollState.tuiMode]);

  useEffect(() => {
    const onWindowBlur = () => stopTuiScroll();
    window.addEventListener("blur", onWindowBlur);
    return () => window.removeEventListener("blur", onWindowBlur);
  }, []);

  const beginTuiDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!scrollState.tuiInteractive || ptyId.current === null) return;
    event.preventDefault();
    stopTuiScroll();
    tuiDragRef.current = { pointerId: event.pointerId, startY: event.clientY };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    terminalRef.current?.focus();
  };

  const updateTuiDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = tuiDragRef.current;
    if (!scrollState.tuiInteractive || !drag || drag.pointerId !== event.pointerId) return;
    const delta = event.clientY - drag.startY;
    const distance = Math.abs(delta);
    if (distance <= TUI_DRAG_DEAD_ZONE_PX) {
      tuiScrollIntentRef.current = null;
      setTuiPull({ direction: "idle", strength: 0 });
      if (tuiScrollTimer.current !== null) {
        window.clearInterval(tuiScrollTimer.current);
        tuiScrollTimer.current = null;
      }
      return;
    }
    const direction = delta < 0 ? "up" : "down";
    const ticks = Math.min(TUI_DRAG_MAX_TICKS, Math.max(1, Math.ceil((distance - TUI_DRAG_DEAD_ZONE_PX) / TUI_DRAG_PIXELS_PER_TICK)));
    const previousDirection = tuiScrollIntentRef.current?.direction;
    tuiScrollIntentRef.current = { direction, ticks };
    setTuiPull({ direction, strength: ticks / TUI_DRAG_MAX_TICKS });
    if (tuiScrollTimer.current === null) {
      sendTuiWheel(direction, ticks);
      tuiScrollTimer.current = window.setInterval(() => {
        const intent = tuiScrollIntentRef.current;
        if (intent) sendTuiWheel(intent.direction, intent.ticks);
      }, TUI_WHEEL_REPEAT_MS);
    } else if (previousDirection && previousDirection !== direction) {
      sendTuiWheel(direction, ticks);
    }
    terminalRef.current?.focus();
  };

  const onTuiControlKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!scrollState.tuiInteractive) return;
    let direction: "up" | "down";
    let ticks: number;
    if (event.key === "ArrowUp") { direction = "up"; ticks = 1; }
    else if (event.key === "ArrowDown") { direction = "down"; ticks = 1; }
    else if (event.key === "PageUp") { direction = "up"; ticks = TUI_WHEEL_STEP; }
    else if (event.key === "PageDown") { direction = "down"; ticks = TUI_WHEEL_STEP; }
    else if (event.key === "Home") { direction = "up"; ticks = TUI_WHEEL_JUMP; }
    else if (event.key === "End") { direction = "down"; ticks = TUI_WHEEL_JUMP; }
    else return;
    event.preventDefault();
    sendTuiWheel(direction, ticks);
    terminalRef.current?.focus();
  };

  return <div className={`wb-terminal-pane${active ? " active" : ""}`} hidden={!active}>
    <div
      className={`wb-terminal-host${pane.group === "session" ? " is-session" : ""}${scrollState.tuiMode ? " is-tui-mode" : ""}${dragOver ? " is-drag-over" : ""}`}
      data-terminal-engine={engineType}
      ref={host}
    />
    {tuiControlVisible ? (
      <div className={`wb-terminal-tui-nav${searchOpen ? " is-below-search" : ""}${scrollState.tuiInteractive ? "" : " is-unavailable"}`}>
        <button
          type="button"
          className="wb-terminal-jump is-top"
          aria-label={t("desktop.workbench.terminalScrollTop")}
          title={t("desktop.workbench.terminalScrollTop")}
          disabled={!scrollState.tuiInteractive}
          onClick={() => { sendTuiWheel("up", TUI_WHEEL_JUMP); terminalRef.current?.focus(); }}
        >
          <ThemeIcon name="arrow-up-to-line" size={15} aria-hidden="true" />
        </button>
        <button
          type="button"
          className={`wb-terminal-tui-drop is-${tuiPull.direction}`}
          aria-disabled={!scrollState.tuiInteractive}
          aria-label={t("desktop.workbench.terminalTuiScrollControl")}
          title={t("desktop.workbench.terminalTuiScrollControl")}
          style={{ "--tui-pull": tuiPull.strength } as CSSProperties}
          onPointerDown={beginTuiDrag}
          onPointerMove={updateTuiDrag}
          onPointerUp={() => stopTuiScroll()}
          onPointerCancel={() => stopTuiScroll()}
          onLostPointerCapture={() => stopTuiScroll()}
          onKeyDown={onTuiControlKeyDown}
        >
          <svg className="wb-terminal-tui-drop-shape" viewBox="0 0 200 260" aria-hidden="true">
            <path d="M 100 20 C 105 50, 165 95, 165 130 C 165 165, 105 210, 100 240 C 95 210, 35 165, 35 130 C 35 95, 95 50, 100 20 Z" />
          </svg>
        </button>
        <button
          type="button"
          className="wb-terminal-jump is-bottom"
          aria-label={t("desktop.workbench.terminalScrollBottom")}
          title={t("desktop.workbench.terminalScrollBottom")}
          disabled={!scrollState.tuiInteractive}
          onClick={() => { sendTuiWheel("down", TUI_WHEEL_JUMP); terminalRef.current?.focus(); }}
        >
          <ThemeIcon name="arrow-down-to-line" size={15} aria-hidden="true" />
        </button>
      </div>
    ) : null}
    {searchOpen ? (
      <div className="wb-terminal-search" role="search">
        <ThemeIcon name="search" size={14} aria-hidden="true" />
        <input
          ref={searchInputRef}
          className="wb-terminal-search-input"
          type="search"
          value={searchQuery}
          placeholder={t("desktop.workbench.terminalSearchPlaceholder")}
          aria-label={t("desktop.workbench.terminalSearchPlaceholder")}
          onChange={(event) => {
            const value = event.target.value;
            setSearchQuery(value);
            runSearch("next", value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              runSearch(event.shiftKey ? "prev" : "next", searchQuery);
            } else if (event.key === "Escape") {
              event.preventDefault();
              closeSearch();
            }
          }}
        />
        <span className="wb-terminal-search-meta" aria-live="polite">
          {searchQuery.trim()
            ? (searchMeta && searchMeta.count > 0
              ? t("desktop.workbench.terminalSearchCount", String(searchMeta.index + 1), String(searchMeta.count))
              : t("desktop.workbench.terminalSearchNoResults"))
            : ""}
        </span>
        <button
          type="button"
          className="wb-terminal-search-btn"
          aria-label={t("desktop.workbench.terminalSearchPrev")}
          onClick={() => runSearch("prev", searchQuery)}
        >
          <ThemeIcon name="arrow-up" size={14} />
        </button>
        <button
          type="button"
          className="wb-terminal-search-btn"
          aria-label={t("desktop.workbench.terminalSearchNext")}
          onClick={() => runSearch("next", searchQuery)}
        >
          <ThemeIcon name="arrow-down" size={14} />
        </button>
        <button
          type="button"
          className="wb-terminal-search-btn"
          aria-label={t("desktop.workbench.terminalSearchClose")}
          onClick={closeSearch}
        >
          <ThemeIcon name="close" size={14} />
        </button>
      </div>
    ) : null}
    {!ready ? (
      <div className="wb-terminal-loading" role="status" aria-live="polite">
        <ThemeIcon name="loader" className="spin" size={18} aria-hidden="true" />
        <span>{t("desktop.common.loading")}</span>
      </div>
    ) : null}
  </div>;
});

