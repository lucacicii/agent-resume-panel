import { Terminal } from "@xterm/xterm";
import { CanvasAddon } from "@xterm/addon-canvas";
import { ClipboardAddon } from "@xterm/addon-clipboard";
import { FitAddon } from "@xterm/addon-fit";
import { ImageAddon } from "@xterm/addon-image";
import { SearchAddon, type ISearchOptions } from "@xterm/addon-search";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import type { DesktopAppearanceState } from "../../../themes";
import { Utf8Base64, writeTerminalSelection, createOsc52ClipboardProvider } from "../terminalClipboard";
import { resolveTerminalTheme, type WorkbenchTerminalThemeId } from "../terminalThemes";
import type {
  ITerminalAdapter,
  TerminalAdapterOptions,
  TerminalBufferInfo,
  TerminalDimensions,
  TerminalEngineType,
  TerminalRendererMode,
  TerminalSearchOptions,
  TerminalSearchResult
} from "./types";

export const DEFAULT_TERMINAL_FONT_FAMILY =
  'Menlo, Monaco, "SF Mono", Consolas, "Cascadia Mono", "Courier New", "PingFang SC", "Hiragino Sans GB", "Noto Sans Mono CJK SC", "Microsoft YaHei UI", monospace';

export const TERMINAL_SEARCH_DECORATIONS = {
  matchBackground: "rgba(250, 204, 21, 0.28)",
  matchBorder: "rgba(234, 179, 8, 0.65)",
  matchOverviewRuler: "rgba(234, 179, 8, 0.8)",
  activeMatchBackground: "rgba(245, 158, 11, 0.55)",
  activeMatchBorder: "rgba(217, 119, 6, 0.95)",
  activeMatchColorOverviewRuler: "rgba(245, 158, 11, 1)"
};

function resolveTransparentTerminalTheme(themeId: WorkbenchTerminalThemeId, appearance: DesktopAppearanceState) {
  return { ...resolveTerminalTheme(themeId, appearance), background: "rgba(0, 0, 0, 0)" };
}

export class XtermTerminalAdapter implements ITerminalAdapter {
  readonly engineType: TerminalEngineType = "xterm";

  private readonly terminal: Terminal;
  private readonly fitAddon: FitAddon;
  private readonly searchAddon: SearchAddon;
  private rendererHandle: { dispose(): void } | null = null;
  private currentRendererMode: TerminalRendererMode;
  private isDisposed = false;
  private containerElement: HTMLElement | null = null;
  private copyListener: ((event: Event) => void) | null = null;

  constructor(private readonly options: TerminalAdapterOptions) {
    this.currentRendererMode = options.rendererMode ?? "webgl";

    this.terminal = new Terminal({
      allowProposedApi: true,
      cursorBlink: true,
      fontFamily: options.fontFamily || DEFAULT_TERMINAL_FONT_FAMILY,
      fontSize: options.fontSize ?? 13,
      letterSpacing: 0,
      lineHeight: 1.0,
      rescaleOverlappingGlyphs: true,
      scrollback: options.scrollback ?? 10_000,
      allowTransparency: options.allowTransparency ?? true,
      theme: resolveTransparentTerminalTheme(options.themeId, options.appearance)
    });

    this.fitAddon = new FitAddon();
    this.terminal.loadAddon(this.fitAddon);

    const unicode11 = new Unicode11Addon();
    this.terminal.loadAddon(unicode11);
    this.terminal.unicode.activeVersion = "11";

    this.searchAddon = new SearchAddon();
    this.terminal.loadAddon(this.searchAddon);

    this.terminal.loadAddon(new WebLinksAddon((_event, uri) => {
      options.onOpenExternalUrl?.(uri);
    }));

    const clipboardProvider = createOsc52ClipboardProvider({
      writeText: (text) => {
        options.onClipboardCopy?.(text);
      }
    });

    this.terminal.loadAddon(
      new (ClipboardAddon as unknown as new (
        base64?: Utf8Base64,
        provider?: typeof clipboardProvider
      ) => ClipboardAddon)(new Utf8Base64(), clipboardProvider)
    );

    this.terminal.loadAddon(
      new ImageAddon({
        storageLimit: 64,
        enableSizeReports: true,
        sixelSupport: false
      })
    );
  }

  get cols(): number {
    return this.terminal.cols;
  }

  get rows(): number {
    return this.terminal.rows;
  }

  open(container: HTMLElement): void {
    if (this.isDisposed) return;
    this.containerElement = container;
    this.terminal.open(container);
    this.rendererHandle = this.loadRenderer(this.currentRendererMode);

    this.copyListener = (event: Event) => {
      const text = this.terminal.getSelection();
      if (!text) return;
      writeTerminalSelection(text, this.options.onClipboardCopy);
      const ce = event as ClipboardEvent;
      if (ce.clipboardData) {
        ce.clipboardData.setData("text/plain", text);
        ce.preventDefault();
      }
    };
    container.addEventListener("copy", this.copyListener);
  }

  dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;
    if (this.containerElement && this.copyListener) {
      this.containerElement.removeEventListener("copy", this.copyListener);
      this.copyListener = null;
    }
    this.rendererHandle?.dispose();
    this.rendererHandle = null;
    try {
      this.terminal.dispose();
    } catch {
      /* ignore */
    }
  }

  write(data: string | Uint8Array, callback?: () => void): void {
    if (this.isDisposed) return;
    this.terminal.write(data, callback);
  }

  resize(cols: number, rows: number): void {
    if (this.isDisposed) return;
    this.terminal.resize(cols, rows);
  }

  fit(): void {
    if (this.isDisposed) return;
    try {
      const buffer = this.terminal.buffer.active;
      const wasAtBottom = buffer.type === "normal" && buffer.viewportY >= buffer.baseY;
      this.fitAddon.fit();
      if (wasAtBottom && this.terminal.buffer.active.type === "normal") {
        this.terminal.scrollToBottom();
      }
    } catch {
      /* hidden panes ignore fit failures */
    }
  }

  proposeDimensions(): TerminalDimensions | null {
    if (this.isDisposed) return null;
    try {
      const dim = this.fitAddon.proposeDimensions();
      if (!dim || !Number.isFinite(dim.cols) || !Number.isFinite(dim.rows)) return null;
      return { cols: dim.cols, rows: dim.rows };
    } catch {
      return null;
    }
  }

  clear(): void {
    if (this.isDisposed) return;
    this.terminal.clear();
  }

  focus(): void {
    if (this.isDisposed) return;
    this.terminal.focus();
  }

  blur(): void {
    if (this.isDisposed) return;
    this.terminal.blur();
  }

  getBufferInfo(): TerminalBufferInfo {
    const buffer = this.terminal.buffer.active;
    return {
      type: buffer.type === "alternate" ? "alternate" : "normal",
      baseY: buffer.baseY,
      viewportY: buffer.viewportY,
      cursorX: buffer.cursorX,
      cursorY: buffer.cursorY,
      length: buffer.length
    };
  }

  getViewportText(maxRows = 30): string[] {
    if (this.isDisposed) return [];
    const buffer = this.terminal.buffer.active;
    const rows = Math.min(maxRows, this.terminal.rows);
    const start = Math.max(0, buffer.viewportY + this.terminal.rows - rows);
    const lines: string[] = [];
    for (let i = 0; i < rows; i += 1) {
      const line = buffer.getLine(start + i);
      if (line) lines.push(line.translateToString(true));
    }
    return lines;
  }

  scrollToBottom(): void {
    if (this.isDisposed) return;
    this.terminal.scrollToBottom();
  }

  scrollLines(amount: number): void {
    if (this.isDisposed) return;
    this.terminal.scrollLines(amount);
  }

  getSelection(): string {
    if (this.isDisposed) return "";
    return this.terminal.getSelection();
  }

  select(col: number, row: number, length: number): void {
    if (this.isDisposed) return;
    this.terminal.select(col, row, length);
  }

  clearSelection(): void {
    if (this.isDisposed) return;
    this.terminal.clearSelection();
  }

  setTheme(themeId: WorkbenchTerminalThemeId, appearance: DesktopAppearanceState): void {
    if (this.isDisposed) return;
    this.terminal.options.theme = resolveTransparentTerminalTheme(themeId, appearance);
  }

  setRendererMode(mode: TerminalRendererMode): void {
    if (this.isDisposed || mode === this.currentRendererMode) return;
    this.currentRendererMode = mode;
    this.rendererHandle?.dispose();
    this.rendererHandle = this.loadRenderer(mode);
    this.refreshAtlas();
  }

  refreshAtlas(): void {
    if (this.isDisposed) return;
    try {
      (this.terminal as unknown as { clearTextureAtlas?: () => void }).clearTextureAtlas?.();
    } catch {
      /* DOM renderer has no atlas */
    }
    try {
      const last = Math.max(0, this.terminal.rows - 1);
      this.terminal.refresh(0, last);
    } catch {
      /* ignore */
    }
  }

  findNext(query: string, options?: TerminalSearchOptions): boolean {
    if (this.isDisposed || !query) {
      this.clearSearchDecorations();
      return false;
    }
    const searchOptions: ISearchOptions = {
      caseSensitive: options?.caseSensitive ?? false,
      regex: options?.regex ?? false,
      incremental: options?.incremental ?? false,
      decorations: TERMINAL_SEARCH_DECORATIONS
    };
    return this.searchAddon.findNext(query, searchOptions);
  }

  findPrevious(query: string, options?: TerminalSearchOptions): boolean {
    if (this.isDisposed || !query) {
      this.clearSearchDecorations();
      return false;
    }
    const searchOptions: ISearchOptions = {
      caseSensitive: options?.caseSensitive ?? false,
      regex: options?.regex ?? false,
      incremental: options?.incremental ?? false,
      decorations: TERMINAL_SEARCH_DECORATIONS
    };
    return this.searchAddon.findPrevious(query, searchOptions);
  }

  clearSearchDecorations(): void {
    if (this.isDisposed) return;
    this.searchAddon.clearDecorations();
  }

  onData(listener: (data: string) => void): { dispose: () => void } {
    const disposable = this.terminal.onData(listener);
    return { dispose: () => disposable.dispose() };
  }

  onResize(listener: (dimensions: TerminalDimensions) => void): { dispose: () => void } {
    const disposable = this.terminal.onResize(({ cols, rows }) => {
      listener({ cols, rows });
    });
    return { dispose: () => disposable.dispose() };
  }

  onWriteParsed(listener: () => void): { dispose: () => void } {
    const disposable = this.terminal.onWriteParsed(listener);
    return { dispose: () => disposable.dispose() };
  }

  onBufferChange(listener: () => void): { dispose: () => void } {
    const disposable = this.terminal.buffer.onBufferChange(listener);
    return { dispose: () => disposable.dispose() };
  }

  onSearchResultsDidChange(listener: (result: TerminalSearchResult) => void): { dispose: () => void } {
    const disposable = this.searchAddon.onDidChangeResults?.((event) => {
      listener({ index: event.resultIndex, count: event.resultCount });
    });
    return { dispose: () => disposable?.dispose() };
  }

  getRawInstance(): Terminal {
    return this.terminal;
  }

  private loadRenderer(mode: TerminalRendererMode): { dispose(): void } {
    let active: { dispose(): void } | null = null;
    let contextLossSub: { dispose(): void } | null = null;

    const loadCanvas = (): boolean => {
      try {
        contextLossSub?.dispose();
        contextLossSub = null;
        try { active?.dispose(); } catch { /* ignore */ }
        active = null;
        const canvas = new CanvasAddon();
        this.terminal.loadAddon(canvas);
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
        this.terminal.loadAddon(webgl);
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
}
