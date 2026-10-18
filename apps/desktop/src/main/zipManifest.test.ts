// @vitest-environment node
import { randomBytes } from "node:crypto";
import { createWriteStream } from "node:fs";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  findEndOfCentralDirectory,
  parseCentralDirectory,
  parseManagedBackupFileName,
  readZipEntry,
  type ZipByteSource
} from "./zipManifest";

/** yazl ships no types; the same local shape backupService declares. */
const yazl = require("yazl") as {
  ZipFile: new () => {
    addBuffer(buffer: Buffer, metadataPath: string): void;
    end(): void;
    outputStream: NodeJS.ReadableStream;
  };
};

const tempDirs: string[] = [];

async function buildZip(entries: Array<{ name: string; contents: string }>): Promise<Buffer> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-resume-zip-test-"));
  tempDirs.push(dir);
  const file = path.join(dir, "archive.zip");
  const zip = new yazl.ZipFile();
  for (const entry of entries) zip.addBuffer(Buffer.from(entry.contents), entry.name);
  const written = new Promise<void>((resolve, reject) => {
    zip.outputStream.on("error", reject).pipe(createWriteStream(file)).on("close", () => resolve());
  });
  zip.end();
  await written;
  return fs.readFile(file);
}

/** Ranged reads over an in-memory archive, counting how much was transferred. */
function source(buffer: Buffer): ZipByteSource & { bytesRead: number } {
  const state = {
    size: buffer.length,
    bytesRead: 0,
    read: async (start: number, end: number): Promise<Buffer> => {
      const slice = buffer.subarray(start, end + 1);
      state.bytesRead += slice.length;
      return slice;
    }
  };
  return state;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("zipManifest", () => {
  it("reads manifest.json out of a deflated archive without transferring the whole file", async () => {
    const payload = JSON.stringify({ formatVersion: 1, createdAtMs: 1_700_000_000_000, files: [] });
    // Incompressible filler so the archive is genuinely large, as a real backup is.
    const archive = await buildZip([
      { name: "manifest.json", contents: payload },
      { name: "payload/catalog.db", contents: randomBytes(512 * 1024).toString("base64") }
    ]);
    const zipSource = source(archive);

    const entry = await readZipEntry(zipSource, "manifest.json");

    expect(entry?.toString("utf8")).toBe(payload);
    // Tail probe + central directory + header + entry: far below the payload.
    expect(zipSource.bytesRead).toBeLessThan(archive.length / 4);
  });

  it("returns null for a missing entry and for a truncated archive", async () => {
    const archive = await buildZip([{ name: "manifest.json", contents: "{}" }]);
    await expect(readZipEntry(source(archive), "absent.json")).resolves.toBeNull();
    await expect(readZipEntry(source(archive.subarray(0, 10)), "manifest.json")).resolves.toBeNull();
  });

  it("finds the end-of-central-directory record even with trailing bytes after it", async () => {
    const archive = await buildZip([{ name: "manifest.json", contents: "{}" }]);
    // A ZIP comment sits after the record; the backwards scan must skip it.
    const withComment = Buffer.concat([archive, Buffer.from("a trailing archive comment")]);
    const tail = withComment.subarray(Math.max(0, withComment.length - 64 * 1024));

    const directory = findEndOfCentralDirectory(tail);
    expect(directory).not.toBeNull();
    const entries = parseCentralDirectory(
      withComment.subarray(directory!.centralOffset, directory!.centralOffset + directory!.centralSize)
    );
    expect(entries.map((item) => item.name)).toContain("manifest.json");
  });
});

describe("parseManagedBackupFileName", () => {
  it("recovers the timestamp, machine, and id from a managed name", () => {
    expect(parseManagedBackupFileName("agent-resume-20251001T101500123Z-abc123-0123456789abcdef0123456789abcdef.zip"))
      .toEqual({
        createdAtMs: Date.UTC(2025, 9, 1, 10, 15, 0, 123),
        sourceMachineId: "abc123",
        backupId: "0123456789abcdef0123456789abcdef"
      });
  });

  it("accepts the UUID machine ids the app actually writes", () => {
    const machineId = "3f2b8c1e-9a4d-4f6b-8e2a-1c5d7b9e0f3a";
    expect(parseManagedBackupFileName(`agent-resume-20251001T101500123Z-${machineId}-0123456789abcdef0123456789abcdef.zip`))
      .toMatchObject({ sourceMachineId: machineId, backupId: "0123456789abcdef0123456789abcdef" });
  });

  it("rejects names the app did not write", () => {
    expect(parseManagedBackupFileName("backup.zip")).toBeNull();
    expect(parseManagedBackupFileName("agent-resume-20251001T101500123Z-abc123-short.zip")).toBeNull();
    expect(parseManagedBackupFileName("agent-resume-20251001T101500123Z-abc123-0123456789abcdef0123456789abcdef.tar")).toBeNull();
  });
});
