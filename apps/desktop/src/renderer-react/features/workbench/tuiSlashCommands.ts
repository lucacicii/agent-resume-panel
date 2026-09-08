/**
 * Static TUI slash-command catalog for Workbench composer.
 * Composer owns the `/` menu; the agent process still executes the command
 * after we write `/{name}\\r` to the PTY. Interactive pickers stay in xterm.
 */

export type TuiSlashCommand = {
  /** Token without a leading `/`. */
  name: string;
  /** Desktop i18n key for the menu subtitle. */
  descriptionKey: string;
  /** After send, focus xterm so the user can finish a TUI picker / confirm. */
  needsTerminalFocus: boolean;
};

export type ParsedTuiSlashCommand = {
  name: string;
  args: string;
  needsTerminalFocus: boolean;
};

export type ComposerSlashItem =
  | { kind: "command"; command: TuiSlashCommand }
  | { kind: "phrase"; trigger: string; phrase: string; description?: string };

const SHARED_COMMANDS: TuiSlashCommand[] = [
  { name: "help", descriptionKey: "desktop.workbench.tuiSlash.help", needsTerminalFocus: false },
  { name: "clear", descriptionKey: "desktop.workbench.tuiSlash.clear", needsTerminalFocus: false },
  { name: "compact", descriptionKey: "desktop.workbench.tuiSlash.compact", needsTerminalFocus: true },
  { name: "model", descriptionKey: "desktop.workbench.tuiSlash.model", needsTerminalFocus: true },
  { name: "new", descriptionKey: "desktop.workbench.tuiSlash.new", needsTerminalFocus: false },
  { name: "quit", descriptionKey: "desktop.workbench.tuiSlash.quit", needsTerminalFocus: false },
  { name: "exit", descriptionKey: "desktop.workbench.tuiSlash.exit", needsTerminalFocus: false }
];

const CODEX_COMMANDS: TuiSlashCommand[] = [
  { name: "review", descriptionKey: "desktop.workbench.tuiSlash.review", needsTerminalFocus: true },
  { name: "undo", descriptionKey: "desktop.workbench.tuiSlash.undo", needsTerminalFocus: false },
  { name: "redo", descriptionKey: "desktop.workbench.tuiSlash.redo", needsTerminalFocus: false },
  { name: "resume", descriptionKey: "desktop.workbench.tuiSlash.resume", needsTerminalFocus: false },
  { name: "tokens", descriptionKey: "desktop.workbench.tuiSlash.tokens", needsTerminalFocus: false },
  { name: "init", descriptionKey: "desktop.workbench.tuiSlash.init", needsTerminalFocus: false },
  { name: "share", descriptionKey: "desktop.workbench.tuiSlash.share", needsTerminalFocus: false }
];

const CLAUDE_COMMANDS: TuiSlashCommand[] = [
  { name: "review", descriptionKey: "desktop.workbench.tuiSlash.review", needsTerminalFocus: true },
  { name: "undo", descriptionKey: "desktop.workbench.tuiSlash.undo", needsTerminalFocus: false },
  { name: "resume", descriptionKey: "desktop.workbench.tuiSlash.resume", needsTerminalFocus: false },
  { name: "init", descriptionKey: "desktop.workbench.tuiSlash.init", needsTerminalFocus: false },
  { name: "permissions", descriptionKey: "desktop.workbench.tuiSlash.permissions", needsTerminalFocus: true }
];

const PI_COMMANDS: TuiSlashCommand[] = [
  { name: "resume", descriptionKey: "desktop.workbench.tuiSlash.resume", needsTerminalFocus: false }
];

const PROVIDER_COMMANDS: Record<string, TuiSlashCommand[]> = {
  codex: CODEX_COMMANDS,
  claude: CLAUDE_COMMANDS,
  pi: PI_COMMANDS
};

function mergeCommands(extra: TuiSlashCommand[]): TuiSlashCommand[] {
  const seen = new Set<string>();
  const output: TuiSlashCommand[] = [];
  for (const command of [...SHARED_COMMANDS, ...extra]) {
    const key = command.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(command);
  }
  return output;
}

const COMMANDS_BY_PROVIDER = new Map<string, TuiSlashCommand[]>();

/** Commands advertised for a CLI session provider. Unknown or unbound panes get the shared set. */
export function tuiSlashCommandsForProvider(provider: string | undefined | null): TuiSlashCommand[] {
  const key = (provider || "").trim().toLowerCase();
  if (!key) return SHARED_COMMANDS;
  const cached = COMMANDS_BY_PROVIDER.get(key);
  if (cached) return cached;
  const next = mergeCommands(PROVIDER_COMMANDS[key] ?? []);
  COMMANDS_BY_PROVIDER.set(key, next);
  return next;
}

export function filterTuiSlashCommands(commands: TuiSlashCommand[], query: string): TuiSlashCommand[] {
  const needle = query.toLowerCase();
  return commands.filter((command) => command.name.toLowerCase().startsWith(needle));
}

export function mergeComposerSlashItems(
  commands: TuiSlashCommand[],
  phrases: Array<{ trigger: string; phrase: string; description?: string }>,
  query: string
): ComposerSlashItem[] {
  const commandItems: ComposerSlashItem[] = filterTuiSlashCommands(commands, query).map((command) => ({
    kind: "command",
    command
  }));
  const needle = query.toLowerCase();
  const phraseItems: ComposerSlashItem[] = phrases
    .filter((phrase) => phrase.trigger.toLowerCase().startsWith(needle))
    .map((phrase) => ({ kind: "phrase", ...phrase }));
  return [...commandItems, ...phraseItems];
}

/**
 * Whole-input `/name` or `/name args` that matches a known TUI command.
 * Mixed prose (`please /clear`) is not a command send.
 */
export function parseLeadingTuiSlash(
  text: string,
  commands: TuiSlashCommand[]
): ParsedTuiSlashCommand | null {
  const trimmed = text.trim();
  const match = trimmed.match(/^\/([A-Za-z0-9_-]+)(?:\s+([\s\S]*))?$/);
  if (!match) return null;
  const name = match[1].toLowerCase();
  const command = commands.find((item) => item.name.toLowerCase() === name);
  if (!command) return null;
  return {
    name: command.name,
    args: (match[2] ?? "").trim(),
    needsTerminalFocus: command.needsTerminalFocus
  };
}

export function formatTuiSlashInput(name: string, args = ""): string {
  const trimmed = args.trim();
  return trimmed ? `/${name} ${trimmed}\r` : `/${name}\r`;
}
