/**
 * TerminalComposer persistence: per-working-directory (cwd) command history and
 * floating position, both stored in localStorage, best-effort (try/catch) so
 * loss is never fatal.
 */

const STORAGE_KEY = "wb-terminal-composer-history";
const HISTORY_CAP = 100;

const POSITION_KEY = "wb-terminal-composer-position";
/** Bottom-left offset (px) matching the `.wb-terminal-composer` CSS defaults. */
export const DEFAULT_COMPOSER_POSITION = { x: 10, y: 8 } as const;
export type ComposerPosition = { x: number; y: number };

function readStore(): Record<string, string[]> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    const store: Record<string, string[]> = {};
    for (const [cwd, commands] of Object.entries(parsed)) {
      if (Array.isArray(commands)) {
        store[cwd] = commands.filter((item): item is string => typeof item === "string");
      }
    }
    return store;
  } catch {
    return {};
  }
}

function writeStore(store: Record<string, string[]>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // storage unavailable (quota / private mode) — history is best-effort
  }
}

/** Load the command history for a working directory (newest first). */
export function loadTerminalComposerHistory(cwd: string): string[] {
  return readStore()[cwd] || [];
}

/**
 * Record a sent command for a working directory. Dedups by exact command and
 * moves the newest occurrence to the front; prunes beyond HISTORY_CAP.
 * Returns the resulting history (the caller updates state in one shot).
 */
export function pushTerminalComposerHistory(cwd: string, command: string): string[] {
  const store = readStore();
  const current = store[cwd] || [];
  const next = [command, ...current.filter((item) => item !== command)].slice(0, HISTORY_CAP);
  store[cwd] = next;
  writeStore(store);
  return next;
}

/** Load the floating composer position for a working directory. */
export function loadTerminalComposerPosition(cwd: string): ComposerPosition {
  try {
    const raw = localStorage.getItem(POSITION_KEY);
    if (!raw) return { ...DEFAULT_COMPOSER_POSITION };
    const parsed: unknown = JSON.parse(raw);
    const entry = (parsed as Record<string, unknown>)?.[cwd] as Partial<ComposerPosition> | undefined;
    if (entry && Number.isFinite(entry.x) && Number.isFinite(entry.y)) {
      return { x: Math.round(entry.x as number), y: Math.round(entry.y as number) };
    }
  } catch {
    // fall through to default
  }
  return { ...DEFAULT_COMPOSER_POSITION };
}

/** Persist the floating composer position for a working directory. */
export function saveTerminalComposerPosition(cwd: string, position: ComposerPosition): void {
  try {
    const raw = localStorage.getItem(POSITION_KEY);
    const store = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    if (typeof store !== "object" || store === null) return;
    store[cwd] = { x: Math.round(position.x), y: Math.round(position.y) };
    localStorage.setItem(POSITION_KEY, JSON.stringify(store));
  } catch {
    // storage unavailable (quota / private mode) — position is best-effort
  }
}
