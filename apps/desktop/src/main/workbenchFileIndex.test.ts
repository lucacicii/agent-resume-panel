import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  listWorkbenchFiles,
  resetWorkbenchFileIndexForTests,
  searchWorkbenchPaths
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
    fs.mkdirSync(path.join(root, "empty-folder"), { recursive: true });
    fs.mkdirSync(path.join(root, "node_modules", "pkg"), { recursive: true });
    fs.writeFileSync(path.join(root, "src", "main.ts"), "export {};\n");
    fs.writeFileSync(path.join(root, ".hidden-file"), "hidden\n");
    fs.writeFileSync(path.join(root, "node_modules", "pkg", "index.js"), "ignored\n");

    const result = await listWorkbenchFiles({ rootPath: root, timeBudgetMs: 5_000 });
    expect(result.files.map((file) => file.relativePath)).toContain("src/main.ts");
    expect(result.files).toContainEqual(expect.objectContaining({ relativePath: "src", kind: "directory" }));
    expect(result.files).toContainEqual(expect.objectContaining({ relativePath: "empty-folder", kind: "directory" }));
    expect(result.files.map((file) => file.relativePath)).toContain(".hidden-file");
    expect(result.files.some((file) => file.relativePath.includes("node_modules"))).toBe(false);
    expect(result.files.every((file) => path.isAbsolute(file.path))).toBe(true);
    expect(result.files.find((file) => file.relativePath === "src/main.ts")?.kind).toBe("file");
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

  it("keeps separate file and directory quotas in the initial index", async () => {
    const root = tempRoot();
    for (let index = 0; index < 4; index += 1) {
      const directory = path.join(root, `dir-${index}`);
      fs.mkdirSync(directory);
      fs.writeFileSync(path.join(directory, `file-${index}.txt`), String(index));
    }
    const result = await listWorkbenchFiles({ rootPath: root, maxFiles: 2, timeBudgetMs: 5_000 });
    expect(result.files.filter((entry) => entry.kind === "file")).toHaveLength(2);
    expect(result.files.filter((entry) => entry.kind === "directory")).toHaveLength(2);
    expect(result.truncated).toBe(true);
  });

  it("searches the full project for a middle path beyond the initial index", async () => {
    const root = tempRoot();
    const relativeDirectory = "web-manager/src/views/sysFinanceCenter/internetPaymentManage/prePaybankPayFail";
    const directory = path.join(root, ...relativeDirectory.split("/"));
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, "index.vue"), "<template />\n");
    for (let index = 0; index < 20; index += 1) {
      fs.writeFileSync(path.join(root, `noise-${index}.txt`), String(index));
    }

    const result = await searchWorkbenchPaths({
      rootPath: root,
      query: "sysFinanceCenter/internetPaymentManage/prePaybankPayFail",
      maxResults: 20,
      timeBudgetMs: 5_000
    });
    expect(result.files).toContainEqual(expect.objectContaining({
      relativePath: relativeDirectory,
      kind: "directory"
    }));
    expect(result.files).toContainEqual(expect.objectContaining({
      relativePath: `${relativeDirectory}/index.vue`,
      kind: "file"
    }));
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
