/**
 * Token parsing helpers for ChatComposer triggers:
 * - `/` slash commands (skills & mcp tools)
 * - `@` context mentions (notes, tasks, sessions)
 * - `#` file and directory references
 */

export function tokenStartAtCursor(value: string, cursor: number): number {
  const before = value.slice(0, cursor);
  return Math.max(before.lastIndexOf(" "), before.lastIndexOf("\n"), before.lastIndexOf("\t")) + 1;
}

/** Join a slash-relative path onto an absolute directory, keeping the platform separator. */
export function joinDirPath(base: string, relative: string): string {
  const separator = base.includes("\\") && !base.includes("/") ? "\\" : "/";
  const trimmed = base.replace(/[\\/]+$/, "");
  const tail = relative.split(/[\\/]+/).filter(Boolean).join(separator);
  return tail ? `${trimmed}${separator}${tail}` : trimmed;
}

/**
 * `/token` at the cursor, e.g. `/browser-use` or `/`.
 * Paths like `/usr/bin` containing slashes inside query are ignored.
 */
export function slashTokenAtCursor(
  value: string,
  cursor: number
): { start: number; query: string } | null {
  const start = tokenStartAtCursor(value, cursor);
  const token = value.slice(start, cursor);
  if (!token.startsWith("/")) return null;
  const query = token.slice(1);
  if (query.includes("/") || /\s/.test(query)) return null;
  return { start, query };
}

/**
 * `@token` at the cursor, e.g. `@task` or `@`.
 * Tokens containing multiple `@` or whitespace are ignored.
 */
export function atTokenAtCursor(
  value: string,
  cursor: number
): { start: number; query: string } | null {
  const start = tokenStartAtCursor(value, cursor);
  const token = value.slice(start, cursor);
  if (!token.startsWith("@") || token.slice(1).includes("@")) return null;
  const query = token.slice(1);
  if (/\s/.test(query)) return null;
  return { start, query };
}

/**
 * `#token` at the cursor. The token may contain `/` to walk into nested
 * directories: `#src/comp` → dirPath `src`, query `comp`; `#src/` → dirPath `src`, query `""`.
 */
export function hashTokenAtCursor(
  value: string,
  cursor: number
): { start: number; dirPath: string; query: string } | null {
  const start = tokenStartAtCursor(value, cursor);
  const token = value.slice(start, cursor);
  if (!token.startsWith("#") || token.slice(1).includes("#")) return null;
  const body = token.slice(1);
  const lastSlash = body.lastIndexOf("/");
  const rawDir = lastSlash >= 0 ? body.slice(0, lastSlash) : "";
  return {
    start,
    dirPath: rawDir.replace(/^(?:\/+)|(?:\/+)$/g, "").replace(/\/{2,}/g, "/"),
    query: lastSlash >= 0 ? body.slice(lastSlash + 1) : body
  };
}
