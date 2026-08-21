import type { ITerminalAdapter, TerminalAdapterOptions, TerminalEngineType } from "./types";
import { XtermTerminalAdapter } from "./XtermTerminalAdapter";
import { GhosttyWebTerminalAdapter } from "./GhosttyWebTerminalAdapter";

export * from "./types";
export { XtermTerminalAdapter, DEFAULT_TERMINAL_FONT_FAMILY, TERMINAL_SEARCH_DECORATIONS } from "./XtermTerminalAdapter";
export { GhosttyWebTerminalAdapter } from "./GhosttyWebTerminalAdapter";

/**
 * Factory for creating terminal engine adapters (xterm vs ghostty-web).
 */
export function createTerminalAdapter(
  engineType: TerminalEngineType = "xterm",
  options: TerminalAdapterOptions
): ITerminalAdapter {
  if (engineType === "ghostty-web") {
    return new GhosttyWebTerminalAdapter(options);
  }
  return new XtermTerminalAdapter(options);
}
