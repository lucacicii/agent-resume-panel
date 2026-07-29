import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  listWorkbenchFiles,
  resetWorkbenchFileIndexForTests
} from "./workbenchFileIndex";

const roots: string[] = [];

function tempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agent-resume-file-index-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  resetWorkbenchFileIndexForTests();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("workbench file index", () => {
  it("lists project files while excluding heavy directories", async () => {
    const root = tempRoot();
    fs.mkdirSync(path.join(root, "src"), { recursive: true });
    fs.mkdirSync(path.join(root, "node_modules", "pkg"), { recursive: true });
    fs.writeFileSync(path.join(root, "src", "main.ts"), "export {};\n");
    fs.writeFileSync(path.join(root, ".hidden-file"), "hidden\n");
    fs.writeFileSync(path.join(root, "node_modules", "pkg", "index.js"), "ignored\n");

    const result = await listWorkbenchFiles({ rootPath: root, timeBudgetMs: 5_000 });
    expect(result.files.map((file) => file.relativePath)).toContain("src/main.ts");
    expect(result.files.map((file) => file.relativePath)).toContain(".hidden-file");
    expect(result.files.some((file) => file.relativePath.includes("node_modules"))).toBe(false);
    expect(result.files.every((file) => path.isAbsolute(file.path))).toBe(true);
  });

  it("caps results and reports truncation", async () => {
    const root = tempRoot();
    for (let index = 0; index < 8; index += 1) {
      fs.writeFileSync(path.join(root, `file-${index}.txt`), String(index));
    }
    const result = await listWorkbenchFiles({ rootPath: root, maxFiles: 2, timeBudgetMs: 5_000 });
    expect(result.files).toHaveLength(2);
    expect(result.truncated).toBe(true);
  });

  it("rejects an already-cancelled request", async () => {
    const root = tempRoot();
    const controller = new AbortController();
    controller.abort();
    await expect(listWorkbenchFiles({ rootPath: root, signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
  });

  it("does not follow a symlink outside the project", async () => {
    const root = tempRoot();
    const outside = tempRoot();
    fs.writeFileSync(path.join(outside, "secret.txt"), "private\n");
    fs.symlinkSync(outside, path.join(root, "outside-link"), "dir");
    const result = await listWorkbenchFiles({ rootPath: root, timeBudgetMs: 5_000 });
    expect(result.files.some((file) => file.relativePath.includes("secret.txt"))).toBe(false);
  });
});
