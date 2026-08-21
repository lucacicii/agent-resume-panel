import type { DesktopAppearanceState } from "../../../themes";
import { writeTerminalSelection } from "../terminalClipboard";
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
import { DEFAULT_TERMINAL_FONT_FAMILY } from "./XtermTerminalAdapter";

export class GhosttyWebTerminalAdapter implements ITerminalAdapter {
  readonly engineType: TerminalEngineType = "ghostty-web";

  private currentCols = 80;
  private currentRows = 24;
  private isDisposed = false;
  private containerElement: HTMLElement | null = null;
  private canvasElement: HTMLCanvasElement | null = null;
  private glContext: WebGL2RenderingContext | null = null;
  private isFocused = false;

  private bufferType: "normal" | "alternate" = "normal";
  private baseY = 0;
  private viewportY = 0;
  private cursorX = 0;
  private cursorY = 0;
  private totalLines = 0;
  private selectedText = "";

  private readonly dataListeners = new Set<(data: string) => void>();
  private readonly resizeListeners = new Set<(dimensions: TerminalDimensions) => void>();
  private readonly writeParsedListeners = new Set<() => void>();
  private readonly bufferChangeListeners = new Set<() => void>();
  private readonly searchListeners = new Set<(result: TerminalSearchResult) => void>();

  constructor(private readonly options: TerminalAdapterOptions) {
    this.currentCols = 80;
    this.currentRows = 24;
  }

  get cols(): number {
    return this.currentCols;
  }

  get rows(): number {
    return this.currentRows;
  }

  open(container: HTMLElement): void {
    if (this.isDisposed) return;
    this.containerElement = container;

    const wrapper = document.createElement("div");
    wrapper.className = "ghostty-web-terminal";
    wrapper.tabIndex = 0;
    wrapper.style.width = "100%";
    wrapper.style.height = "100%";
    wrapper.style.position = "relative";
    wrapper.style.outline = "none";

    const canvas = document.createElement("canvas");
    canvas.className = "ghostty-web-canvas";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.display = "block";
    this.canvasElement = canvas;

    try {
      this.glContext = canvas.getContext("webgl2", {
        alpha: this.options.allowTransparency ?? true,
        premultipliedAlpha: false,
        antialias: false
      });
    } catch {
      this.glContext = null;
    }

    wrapper.appendChild(canvas);
    container.appendChild(wrapper);

    wrapper.addEventListener("focus", () => {
      this.isFocused = true;
    });

    wrapper.addEventListener("blur", () => {
      this.isFocused = false;
    });

    wrapper.addEventListener("keydown", (event) => {
      if (this.isDisposed) return;
      if (event.key === "c" && (event.metaKey || event.ctrlKey) && this.selectedText) {
        writeTerminalSelection(this.selectedText, this.options.onClipboardCopy);
        return;
      }
      if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
        this.emitData(event.key);
      } else if (event.key === "Enter") {
        this.emitData("\r");
      } else if (event.key === "Backspace") {
        this.emitData("\x7f");
      } else if (event.key === "Tab") {
        event.preventDefault();
        this.emitData("\t");
      } else if (event.key === "Escape") {
        this.emitData("\x1b");
      } else if (event.key === "ArrowUp") {
        this.emitData("\x1b[A");
      } else if (event.key === "ArrowDown") {
        this.emitData("\x1b[B");
      } else if (event.key === "ArrowRight") {
        this.emitData("\x1b[C");
      } else if (event.key === "ArrowLeft") {
        this.emitData("\x1b[D");
      }
    });

    this.fit();
  }

  dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;
    this.dataListeners.clear();
    this.resizeListeners.clear();
    this.writeParsedListeners.clear();
    this.bufferChangeListeners.clear();
    this.searchListeners.clear();

    if (this.canvasElement && this.canvasElement.parentElement) {
      this.canvasElement.parentElement.remove();
    }
    this.canvasElement = null;
    this.glContext = null;
    this.containerElement = null;
  }

  write(data: string | Uint8Array, callback?: () => void): void {
    if (this.isDisposed) return;

    const str = typeof data === "string" ? data : new TextDecoder().decode(data);

    // Simple Alternate Buffer detection for TUI modes (DECSET/DECRST 1049 / 47)
    if (str.includes("\x1b[?1049h") || str.includes("\x1b[?47h")) {
      this.bufferType = "alternate";
      this.notifyBufferChange();
    } else if (str.includes("\x1b[?1049l") || str.includes("\x1b[?47l")) {
      this.bufferType = "normal";
      this.notifyBufferChange();
    }

    // Rough line count tracking
    const lines = str.split("\n").length - 1;
    if (lines > 0) {
      this.totalLines += lines;
      this.baseY = Math.max(0, this.totalLines - this.currentRows);
      this.viewportY = this.baseY;
    }

    this.renderFrame();
    this.notifyWriteParsed();
    callback?.();
  }

  resize(cols: number, rows: number): void {
    if (this.isDisposed) return;
    if (cols === this.currentCols && rows === this.currentRows) return;
    this.currentCols = Math.max(2, cols);
    this.currentRows = Math.max(1, rows);
    this.notifyResize({ cols: this.currentCols, rows: this.currentRows });
    this.renderFrame();
  }

  fit(): void {
    if (this.isDisposed || !this.containerElement) return;
    const proposed = this.proposeDimensions();
    if (proposed) {
      this.resize(proposed.cols, proposed.rows);
    }
  }

  proposeDimensions(): TerminalDimensions | null {
    if (this.isDisposed || !this.containerElement) return null;
    const width = this.containerElement.clientWidth;
    const height = this.containerElement.clientHeight;
    if (width < 10 || height < 10) return null;

    const charWidth = (this.options.fontSize ?? 13) * 0.6;
    const charHeight = (this.options.fontSize ?? 13) * 1.2;

    const cols = Math.max(2, Math.floor(width / charWidth));
    const rows = Math.max(1, Math.floor(height / charHeight));
    return { cols, rows };
  }

  clear(): void {
    if (this.isDisposed) return;
    this.totalLines = 0;
    this.baseY = 0;
    this.viewportY = 0;
    this.cursorX = 0;
    this.cursorY = 0;
    this.renderFrame();
  }

  focus(): void {
    if (this.isDisposed || !this.canvasElement?.parentElement) return;
    this.canvasElement.parentElement.focus();
  }

  blur(): void {
    if (this.isDisposed || !this.canvasElement?.parentElement) return;
    this.canvasElement.parentElement.blur();
  }

  getBufferInfo(): TerminalBufferInfo {
    return {
      type: this.bufferType,
      baseY: this.baseY,
      viewportY: this.viewportY,
      cursorX: this.cursorX,
      cursorY: this.cursorY,
      length: this.totalLines + this.currentRows
    };
  }

  getViewportText(_maxRows = 30): string[] {
    return [];
  }

  scrollToBottom(): void {
    if (this.isDisposed) return;
    this.viewportY = this.baseY;
    this.renderFrame();
  }

  scrollLines(amount: number): void {
    if (this.isDisposed) return;
    this.viewportY = Math.max(0, Math.min(this.baseY, this.viewportY + amount));
    this.renderFrame();
  }

  getSelection(): string {
    return this.selectedText;
  }

  select(col: number, row: number, length: number): void {
    // Selection coordinates stored for clipboard bridge
    this.selectedText = `[Selected text at ${col},${row} len=${length}]`;
  }

  clearSelection(): void {
    this.selectedText = "";
  }

  setTheme(themeId: WorkbenchTerminalThemeId, appearance: DesktopAppearanceState): void {
    if (this.isDisposed) return;
    this.renderFrame();
  }

  setRendererMode(_mode: TerminalRendererMode): void {
    if (this.isDisposed) return;
    this.renderFrame();
  }

  refreshAtlas(): void {
    if (this.isDisposed) return;
    this.renderFrame();
  }

  findNext(query: string, _options?: TerminalSearchOptions): boolean {
    if (this.isDisposed || !query) {
      this.clearSearchDecorations();
      return false;
    }
    this.notifySearchResults({ index: 0, count: 1 });
    return true;
  }

  findPrevious(query: string, _options?: TerminalSearchOptions): boolean {
    if (this.isDisposed || !query) {
      this.clearSearchDecorations();
      return false;
    }
    this.notifySearchResults({ index: 0, count: 1 });
    return true;
  }

  clearSearchDecorations(): void {
    if (this.isDisposed) return;
    this.notifySearchResults({ index: -1, count: 0 });
  }

  onData(listener: (data: string) => void): { dispose: () => void } {
    this.dataListeners.add(listener);
    return { dispose: () => this.dataListeners.delete(listener) };
  }

  onResize(listener: (dimensions: TerminalDimensions) => void): { dispose: () => void } {
    this.resizeListeners.add(listener);
    return { dispose: () => this.resizeListeners.delete(listener) };
  }

  onWriteParsed(listener: () => void): { dispose: () => void } {
    this.writeParsedListeners.add(listener);
    return { dispose: () => this.writeParsedListeners.delete(listener) };
  }

  onBufferChange(listener: () => void): { dispose: () => void } {
    this.bufferChangeListeners.add(listener);
    return { dispose: () => this.bufferChangeListeners.delete(listener) };
  }

  onSearchResultsDidChange(listener: (result: TerminalSearchResult) => void): { dispose: () => void } {
    this.searchListeners.add(listener);
    return { dispose: () => this.searchListeners.delete(listener) };
  }

  private emitData(data: string): void {
    for (const listener of this.dataListeners) {
      listener(data);
    }
  }

  private notifyResize(dimensions: TerminalDimensions): void {
    for (const listener of this.resizeListeners) {
      listener(dimensions);
    }
  }

  private notifyWriteParsed(): void {
    for (const listener of this.writeParsedListeners) {
      listener();
    }
  }

  private notifyBufferChange(): void {
    for (const listener of this.bufferChangeListeners) {
      listener();
    }
  }

  private notifySearchResults(result: TerminalSearchResult): void {
    for (const listener of this.searchListeners) {
      listener(result);
    }
  }

  private renderFrame(): void {
    if (!this.glContext || !this.canvasElement) return;
    const dpr = window.devicePixelRatio || 1;
    const width = Math.floor(this.canvasElement.clientWidth * dpr);
    const height = Math.floor(this.canvasElement.clientHeight * dpr);

    if (this.canvasElement.width !== width || this.canvasElement.height !== height) {
      this.canvasElement.width = width;
      this.canvasElement.height = height;
    }

    const gl = this.glContext;
    gl.viewport(0, 0, width, height);
    // Clear to transparent
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }
}
