import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createWorkbenchFile,
  inspectWorkbenchFile,
  saveWorkbenchFile
} from "./workbenchFileIo";

const roots: string[] = [];

function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  roots.push(dir);
  return dir;
}

afterEach(() => {
  while (roots.length) fs.rmSync(roots.pop()!, { recursive: true, force: true });
});

describe("workbench file synchronization I/O", () => {
  it("reports a deleted file without recreating it during a normal save", () => {
    const root = tempDir("workbench-file-sync-");
    const file = path.join(root, "deleted.txt");

    expect(inspectWorkbenchFile(root, file)).toEqual({ kind: "missing" });
    expect(saveWorkbenchFile(root, file, "local", "utf8", "old-version")).toEqual({
      ok: false,
      reason: "missing"
    });
    expect(fs.existsSync(file)).toBe(false);
  });

  it("reports missing when an ancestor directory was deleted", () => {
    const root = tempDir("workbench-file-sync-");
    const directory = path.join(root, "nested");
    const file = path.join(directory, "file.txt");
    fs.mkdirSync(directory);
    fs.writeFileSync(file, "before");
    fs.rmSync(directory, { recursive: true, force: true });

    expect(inspectWorkbenchFile(root, file)).toEqual({ kind: "missing" });
    expect(saveWorkbenchFile(root, file, "local", "utf8", "old-version")).toEqual({
      ok: false,
      reason: "missing"
    });
  });

  it("recreates a deleted file only once with exclusive create semantics", () => {
    const root = tempDir("workbench-file-sync-");
    const file = path.join(root, "restored.txt");

    const created = createWorkbenchFile(root, file, "restored\n", "utf8");
    expect(created.ok).toBe(true);
    expect(fs.readFileSync(file, "utf8")).toBe("restored\n");
    expect(createWorkbenchFile(root, file, "overwrite", "utf8")).toEqual({
      ok: false,
      reason: "exists"
    });
    expect(fs.readFileSync(file, "utf8")).toBe("restored\n");
  });

  it("rejects recreation through a symlinked parent outside the project", () => {
    const root = tempDir("workbench-file-sync-root-");
    const outside = tempDir("workbench-file-sync-outside-");
    const link = path.join(root, "outside-link");
    fs.symlinkSync(outside, link, "dir");

    expect(() => createWorkbenchFile(root, path.join(link, "escape.txt"), "no", "utf8"))
      .toThrow("路径超出允许范围");
    expect(fs.existsSync(path.join(outside, "escape.txt"))).toBe(false);
  });
});
