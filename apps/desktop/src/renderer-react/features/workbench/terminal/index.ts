import type { ITerminalAdapter, TerminalAdapterOptions, TerminalEngineType } from "./types";
import { XtermTerminalAdapter } from "./XtermTerminalAdapter";

export * from "./types";
export { XtermTerminalAdapter, DEFAULT_TERMINAL_FONT_FAMILY, TERMINAL_SEARCH_DECORATIONS } from "./XtermTerminalAdapter";

/**
 * Factory for creating terminal engine adapters.
 */
export function createTerminalAdapter(
  _engineType: TerminalEngineType = "xterm",
  options: TerminalAdapterOptions
): ITerminalAdapter {
  return new XtermTerminalAdapter(options);
}
