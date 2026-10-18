import { inflateRawSync } from "node:zlib";

/**
 * Read a single entry out of a ZIP using only ranged reads.
 *
 * Managed backups are 200 MB or more, and the list view needs nothing but
 * `manifest.json`, so the WebDAV provider reads the end-of-central-directory,
 * then the central directory, then that one entry. A server that ignores
 * `Range` makes this impossible without downloading the whole archive; callers
 * detect that and fall back to filename metadata instead.
 */
export interface ZipEntryInfo {
  name: string;
  compressionMethod: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

export interface ZipByteSource {
  /** Total size in bytes. */
  size: number;
  /** Read `[start, end]` inclusive. Throws when the server ignores the range. */
  read(start: number, end: number): Promise<Buffer>;
}

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const EOCD_MIN_BYTES = 22;
/** The archive builder never emits ZIP64 (the 2 GB archive cap is far below 4 GB). */
const TAIL_PROBE_BYTES = 64 * 1024;
const MAX_CENTRAL_DIRECTORY_BYTES = 32 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 16 * 1024 * 1024;

export function findEndOfCentralDirectory(tail: Buffer): { centralOffset: number; centralSize: number; entryCount: number } | null {
  // The comment length field means the record can sit anywhere in the tail;
  // scan backwards so a trailing comment cannot hide it.
  for (let offset = tail.length - EOCD_MIN_BYTES; offset >= 0; offset -= 1) {
    if (tail.readUInt32LE(offset) !== EOCD_SIGNATURE) continue;
    const entryCount = tail.readUInt16LE(offset + 10);
    const centralSize = tail.readUInt32LE(offset + 12);
    const centralOffset = tail.readUInt32LE(offset + 16);
    // 0xFFFFFFFF marks ZIP64, which this writer never produces.
    if (centralSize === 0xffffffff || centralOffset === 0xffffffff) return null;
    if (centralSize > MAX_CENTRAL_DIRECTORY_BYTES) return null;
    return { centralOffset, centralSize, entryCount };
  }
  return null;
}

export function parseCentralDirectory(buffer: Buffer): ZipEntryInfo[] {
  const entries: ZipEntryInfo[] = [];
  let offset = 0;
  while (offset + 46 <= buffer.length) {
    if (buffer.readUInt32LE(offset) !== CENTRAL_SIGNATURE) break;
    const flags = buffer.readUInt16LE(offset + 8);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const entry: ZipEntryInfo = {
      name: buffer.subarray(offset + 46, offset + 46 + nameLength).toString("utf8"),
      compressionMethod: buffer.readUInt16LE(offset + 10),
      compressedSize: buffer.readUInt32LE(offset + 20),
      uncompressedSize: buffer.readUInt32LE(offset + 24),
      localHeaderOffset: buffer.readUInt32LE(offset + 42)
    };
    // Bit 11 is UTF-8; filenames are ASCII in this archive, so no flag handling is needed.
    void flags;
    entries.push(entry);
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** Parse and decompress one entry; `null` when the entry is missing or unreadable. */
export async function readZipEntry(source: ZipByteSource, name: string): Promise<Buffer | null> {
  if (source.size < EOCD_MIN_BYTES) return null;
  const tailStart = Math.max(0, source.size - TAIL_PROBE_BYTES);
  const tail = await source.read(tailStart, source.size - 1);
  const directory = findEndOfCentralDirectory(tail);
  if (!directory || directory.centralSize === 0) return null;

  const central = await source.read(directory.centralOffset, directory.centralOffset + directory.centralSize - 1);
  const entry = parseCentralDirectory(central).find((item) => item.name === name);
  if (!entry || entry.compressedSize > MAX_MANIFEST_BYTES) return null;

  const header = await source.read(entry.localHeaderOffset, entry.localHeaderOffset + 29);
  if (header.length < 30 || header.readUInt32LE(0) !== LOCAL_SIGNATURE) return null;
  const nameLength = header.readUInt16LE(26);
  const extraLength = header.readUInt16LE(28);
  const dataStart = entry.localHeaderOffset + 30 + nameLength + extraLength;
  if (entry.compressedSize === 0) return Buffer.alloc(0);
  const data = await source.read(dataStart, dataStart + entry.compressedSize - 1);
  if (data.length < entry.compressedSize) return null;

  if (entry.compressionMethod === 0) return data;
  if (entry.compressionMethod !== 8) return null;
  try {
    return inflateRawSync(data);
  } catch {
    return null;
  }
}

/**
 * Recover what the filename encodes, for servers that will not serve ranges.
 *
 * Managed names are `agent-resume-<YYYYMMDDTHHMMSSmmmZ>-<machineId>-<backupId>.(zip|arbak)`.
 * The machine id is a UUID, so it contains dashes; the 32-hex backup id anchors
 * the end of the match.
 */
export function parseManagedBackupFileName(fileName: string): { createdAtMs: number; sourceMachineId: string; backupId: string } | null {
  const match = /^agent-resume-(\d{8}T\d{9}Z)-([A-Za-z0-9-]+)-([a-f0-9]{32})\.(?:zip|arbak)$/i.exec(fileName);
  if (!match) return null;
  const [, stamp, machineId, id] = match;
  const year = Number(stamp.slice(0, 4));
  const month = Number(stamp.slice(4, 6));
  const day = Number(stamp.slice(6, 8));
  const hour = Number(stamp.slice(9, 11));
  const minute = Number(stamp.slice(11, 13));
  const second = Number(stamp.slice(13, 15));
  const millisecond = Number(stamp.slice(15, 18));
  const createdAtMs = Date.UTC(year, month - 1, day, hour, minute, second, millisecond);
  if (!Number.isFinite(createdAtMs)) return null;
  return { createdAtMs, sourceMachineId: machineId, backupId: id };
}
