import * as path from "node:path";

/** Sanitize a terminal name to match herdr-core's constraints (1-32 of a-z0-9._-, not tN/sN). */
export function sanitizeHerdrTerminalName(raw?: string): string | undefined {
  if (!raw) {
    return undefined;
  }
  const normalized = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[^a-z0-9]+/, "")
    .replace(/-+$/, "")
    .slice(0, 32)
    .replace(/-+$/, "");
  if (!normalized || /^[ts]\d+$/i.test(normalized)) {
    return undefined;
  }
  return normalized;
}

/**
 * Pick a unique terminal name not colliding (case-insensitively) with any live terminal name.
 * Appends `-2`, `-3`, ... while keeping the result <= 32 characters.
 */
export function resolveUniqueHerdrTerminalName(
  raw: string | undefined,
  existingLiveNames: Iterable<string>
): string | undefined {
  const base = sanitizeHerdrTerminalName(raw);
  if (!base) {
    return undefined;
  }
  const used = new Set<string>();
  for (const item of existingLiveNames) {
    const trimmed = item.trim().toLowerCase();
    if (trimmed) {
      used.add(trimmed);
    }
  }
  if (!used.has(base)) {
    return base;
  }
  for (let suffixNum = 2; suffixNum < 1000; suffixNum++) {
    const suffix = `-${suffixNum}`;
    const maxBaseLen = Math.max(1, 32 - suffix.length);
    const trimmedBase = base.slice(0, maxBaseLen).replace(/-+$/, "") || base.slice(0, maxBaseLen);
    const candidate = `${trimmedBase}${suffix}`;
    if (!used.has(candidate) && !/^[ts]\d+$/i.test(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

/** Derive a Herdr Space name from a folder path's final path component. */
export function deriveSpaceNameFromFolder(folder?: string): string {
  if (!folder) {
    return "";
  }
  const trimmed = folder.trim().replace(/[\\/]+$/, "");
  if (!trimmed) {
    return "";
  }
  const base = path.basename(trimmed);
  if (!base || base === "." || base === "/" || base === "\\") {
    return "";
  }
  return base;
}

/** Return true if a herdr-core error indicates a terminal name collision. */
export function isHerdrNameConflictError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    /name.*(in use|exists|taken|conflict|duplicate)/i.test(message) ||
    /(in use|exists|taken|conflict|duplicate).*name/i.test(message)
  );
}
