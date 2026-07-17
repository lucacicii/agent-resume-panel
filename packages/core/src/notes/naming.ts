const NOTE_FILENAME_RE = /^(\d{4}-\d{2}-\d{2})-(\d+)\.md$/;

/** Local calendar date as YYYY-MM-DD. */
export function localDateString(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function formatNoteFilename(dateStr: string, sequence: number): string {
  const width = sequence < 100 ? 2 : String(sequence).length;
  return `${dateStr}-${String(sequence).padStart(width, "0")}.md`;
}

export function nextNoteFilename(existingFilenames: string[], date: Date = new Date()): string {
  const dateStr = localDateString(date);
  let max = 0;
  for (const name of existingFilenames) {
    const match = NOTE_FILENAME_RE.exec(name);
    if (!match || match[1] !== dateStr) {
      continue;
    }
    const n = Number.parseInt(match[2], 10);
    if (Number.isFinite(n) && n > max) {
      max = n;
    }
  }
  return formatNoteFilename(dateStr, max + 1);
}

export function parseNoteFilename(filename: string): { dateStr: string; sequence: number } | undefined {
  const match = NOTE_FILENAME_RE.exec(filename);
  if (!match) {
    return undefined;
  }
  return { dateStr: match[1], sequence: Number.parseInt(match[2], 10) };
}

export function noteAssetsDirName(filename: string): string {
  const stem = filename.endsWith(".md") ? filename.slice(0, -3) : filename;
  return `${stem}.assets`;
}

export function noteStem(filename: string): string {
  return filename.endsWith(".md") ? filename.slice(0, -3) : filename;
}

export function normalizeNoteFilename(input: string): string | undefined {
  let name = input.trim();
  if (!name) {
    return undefined;
  }
  name = name.replace(/\\/g, "/").split("/").pop() ?? name;
  if (!name.toLowerCase().endsWith(".md")) {
    name = `${name}.md`;
  }
  const stem = noteStem(name);
  if (!stem || stem === "." || stem === "..") {
    return undefined;
  }
  const safeStem = stem
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/\.+$/g, "")
    .trim();
  if (!safeStem) {
    return undefined;
  }
  return `${safeStem}.md`;
}

export function rewriteAssetReferences(content: string, oldFilename: string, newFilename: string): string {
  const oldAssets = noteAssetsDirName(oldFilename);
  const newAssets = noteAssetsDirName(newFilename);
  if (oldAssets === newAssets) {
    return content;
  }
  return content.split(oldAssets).join(newAssets);
}

export function uniqueNoteFilename(desired: string, existingFilenames: string[]): string {
  const normalized = normalizeNoteFilename(desired);
  if (!normalized) {
    return nextNoteFilename(existingFilenames);
  }
  if (!existingFilenames.includes(normalized)) {
    return normalized;
  }
  const stem = noteStem(normalized);
  let n = 2;
  while (existingFilenames.includes(`${stem}-${n}.md`)) {
    n += 1;
  }
  return `${stem}-${n}.md`;
}