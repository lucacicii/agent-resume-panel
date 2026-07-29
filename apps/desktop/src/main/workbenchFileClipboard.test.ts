import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  copyPathsIntoWorkbench,
  parsePasteboardPaths,
  uniqueCopyDestination
} from "./workbenchFileClipboard";

const roots: string[] = [];

function tempDir(prefix: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("workbench file clipboard", () => {
  it("parses only absolute file paths from the macOS pasteboard result", () => {
    expect(parsePasteboardPaths(JSON.stringify(["/tmp/a.txt", "relative.txt", 42, "/tmp/b"])))
      .toEqual(["/tmp/a.txt", "/tmp/b"]);
    expect(() => parsePasteboardPaths(JSON.stringify({ path: "/tmp/a.txt" }))).toThrow("无法读取文件剪贴板");
  });

  it("generates Finder-style copy names without overwriting an existing entry", () => {
    const target = tempDir("agent-resume-clipboard-");
    fs.writeFileSync(path.join(target, "report.md"), "first");
    fs.writeFileSync(path.join(target, "report copy.md"), "second");
    fs.mkdirSync(path.join(target, "assets"));

    expect(uniqueCopyDestination(target, "report.md", false)).toBe(path.join(target, "report copy 2.md"));
    expect(uniqueCopyDestination(target, "assets", true)).toBe(path.join(target, "assets copy"));
  });

  it("copies files, directories, and symbolic links while retaining links", async () => {
    const root = tempDir("agent-resume-clipboard-root-");
    const source = tempDir("agent-resume-clipboard-source-");
    const target = path.join(root, "target");
    fs.mkdirSync(target);
    fs.writeFileSync(path.join(source, "note.txt"), "hello");
    fs.mkdirSync(path.join(source, "folder"));
    fs.writeFileSync(path.join(source, "folder", "nested.txt"), "nested");
    fs.symlinkSync(path.join(source, "note.txt"), path.join(source, "note-link"));

    const result = await copyPathsIntoWorkbench(root, target, [
      path.join(source, "note.txt"),
      path.join(source, "folder"),
      path.join(source, "note-link")
    ]);

    expect(result.failures).toEqual([]);
    expect(result.copied).toHaveLength(3);
    expect(fs.readFileSync(path.join(target, "note.txt"), "utf8")).toBe("hello");
    expect(fs.readFileSync(path.join(target, "folder", "nested.txt"), "utf8")).toBe("nested");
    expect(fs.lstatSync(path.join(target, "note-link")).isSymbolicLink()).toBe(true);
  });

  it("uses a copy suffix and continues after an invalid clipboard source", async () => {
    const root = tempDir("agent-resume-clipboard-root-");
    const source = tempDir("agent-resume-clipboard-source-");
    const target = path.join(root, "target");
    fs.mkdirSync(target);
    fs.writeFileSync(path.join(source, "note.txt"), "source");
    fs.writeFileSync(path.join(target, "note.txt"), "existing");

    const result = await copyPathsIntoWorkbench(root, target, [
      path.join(source, "missing.txt"),
      path.join(source, "note.txt")
    ]);

    expect(result.failures).toHaveLength(1);
    expect(result.copied).toEqual([expect.objectContaining({
      destinationPath: path.join(fs.realpathSync(target), "note copy.txt")
    })]);
    expect(fs.readFileSync(path.join(target, "note.txt"), "utf8")).toBe("existing");
    expect(fs.readFileSync(path.join(target, "note copy.txt"), "utf8")).toBe("source");
  });

  it("rejects a target outside the selected project and a self-descendant directory copy", async () => {
    const root = tempDir("agent-resume-clipboard-root-");
    const source = path.join(root, "source");
    const descendant = path.join(source, "child");
    const outside = tempDir("agent-resume-clipboard-outside-");
    fs.mkdirSync(descendant, { recursive: true });

    await expect(copyPathsIntoWorkbench(root, outside, [source])).rejects.toThrow("路径超出允许范围");
    const result = await copyPathsIntoWorkbench(root, descendant, [source]);
    expect(result.copied).toEqual([]);
    expect(result.failures[0]?.message).toContain("不能将文件夹复制到自身");
  });

  it("rejects a target symlink that escapes the selected project", async () => {
    const root = tempDir("agent-resume-clipboard-root-");
    const outside = tempDir("agent-resume-clipboard-outside-");
    const source = path.join(root, "note.txt");
    const targetLink = path.join(root, "outside-link");
    fs.writeFileSync(source, "note");
    fs.symlinkSync(outside, targetLink, "dir");

    await expect(copyPathsIntoWorkbench(root, targetLink, [source])).rejects.toThrow("路径超出允许范围");
    expect(fs.existsSync(path.join(outside, "note.txt"))).toBe(false);
  });
});
