import type { DesktopAppearanceState } from "../../../themes";
import type { WorkbenchTerminalThemeId } from "../terminalThemes";

export type TerminalEngineType = "xterm" | "ghostty-web";

export type TerminalRendererMode = "webgl" | "canvas";

export interface TerminalDimensions {
  cols: number;
  rows: number;
}

export interface TerminalBufferInfo {
  type: "normal" | "alternate";
  baseY: number;
  viewportY: number;
  cursorX: number;
  cursorY: number;
  length: number;
}

export interface TerminalSearchOptions {
  caseSensitive?: boolean;
  regex?: boolean;
  incremental?: boolean;
}

export interface TerminalSearchResult {
  index: number;
  count: number;
}

export interface TerminalAdapterOptions {
  themeId: WorkbenchTerminalThemeId;
  appearance: DesktopAppearanceState;
  rendererMode?: TerminalRendererMode;
  fontSize?: number;
  fontFamily?: string;
  scrollback?: number;
  allowTransparency?: boolean;
  onOpenExternalUrl?: (url: string) => void;
  onClipboardCopy?: (text: string) => void;
}

export interface ITerminalAdapter {
  readonly engineType: TerminalEngineType;
  readonly cols: number;
  readonly rows: number;

  open(container: HTMLElement): void;
  dispose(): void;

  write(data: string | Uint8Array, callback?: () => void): void;
  resize(cols: number, rows: number): void;
  fit(): void;
  proposeDimensions(): TerminalDimensions | null;
  clear(): void;
  focus(): void;
  blur(): void;

  // Buffer state and scrolling
  getBufferInfo(): TerminalBufferInfo;
  getViewportText(maxRows?: number): string[];
  scrollToBottom(): void;
  scrollLines(amount: number): void;

  // Selection
  getSelection(): string;
  select(col: number, row: number, length: number): void;
  clearSelection(): void;

  // Configuration and rendering
  setTheme(themeId: WorkbenchTerminalThemeId, appearance: DesktopAppearanceState): void;
  setRendererMode(mode: TerminalRendererMode): void;
  refreshAtlas(): void;

  // Search
  findNext(query: string, options?: TerminalSearchOptions): boolean;
  findPrevious(query: string, options?: TerminalSearchOptions): boolean;
  clearSearchDecorations(): void;

  // Event handlers
  onData(listener: (data: string) => void): { dispose: () => void };
  onResize(listener: (dimensions: TerminalDimensions) => void): { dispose: () => void };
  onWriteParsed(listener: () => void): { dispose: () => void };
  onBufferChange(listener: () => void): { dispose: () => void };
  onSearchResultsDidChange?(listener: (result: TerminalSearchResult) => void): { dispose: () => void };

  // Underlying raw instance (for backward compatibility during migration)
  getRawInstance?(): unknown;
}
