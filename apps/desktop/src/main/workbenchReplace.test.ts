import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { replaceWorkbenchText } from "./workbenchReplace";
import {
  resetWorkbenchSearchStateForTests,
  searchWorkbenchText,
  splitGlobList
} from "./workbenchSearch";

const roots: string[] = [];

function makeRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agent-resume-workbench-replace-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  resetWorkbenchSearchStateForTests();
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("workbenchReplaceText", () => {
  it("replaces every occurrence across the given files", async () => {
    const root = makeRoot();
    fs.writeFileSync(path.join(root, "a.ts"), "const findme = 1;\nfindme();\n", "utf8");
    fs.writeFileSync(path.join(root, "b.ts"), "no match\n", "utf8");

    const result = await replaceWorkbenchText({
      rootPath: root,
      query: "findme",
      replaceWith: "replaced",
      files: [path.join(root, "a.ts"), path.join(root, "b.ts")]
    });

    expect(result.totalReplaced).toBe(2);
    expect(result.replaced).toEqual([
      { path: "a.ts", count: 2 }
    ]);
    expect(result.skipped).toEqual([{ path: "b.ts", reason: "stale" }]);
    expect(fs.readFileSync(path.join(root, "a.ts"), "utf8")).toBe("const replaced = 1;\nreplaced();\n");
  });

  it("honors matchCase / wholeWord / useRegex like the search engine", async () => {
    const root = makeRoot();
    fs.writeFileSync(path.join(root, "a.ts"), "Hello hello HELLO\n", "utf8");

    // matchCase: only exact-case occurrences
    let result = await replaceWorkbenchText({
      rootPath: root,
      query: "hello",
      replaceWith: "x",
      matchCase: true,
      files: [path.join(root, "a.ts")]
    });
    expect(result.totalReplaced).toBe(1);
    expect(fs.readFileSync(path.join(root, "a.ts"), "utf8")).toBe("Hello x HELLO\n");

    // wholeWord: does not touch HelloWorld
    fs.writeFileSync(path.join(root, "a.ts"), "Hello HelloWorld\n", "utf8");
    result = await replaceWorkbenchText({
      rootPath: root,
      query: "Hello",
      replaceWith: "x",
      wholeWord: true,
      files: [path.join(root, "a.ts")]
    });
    expect(result.totalReplaced).toBe(1);
    expect(fs.readFileSync(path.join(root, "a.ts"), "utf8")).toBe("x HelloWorld\n");
  });

  it("expands regex backreferences but keeps replacement text literal otherwise", async () => {
    const root = makeRoot();
    fs.writeFileSync(path.join(root, "a.ts"), "foo(bar) $x\n", "utf8");

    const result = await replaceWorkbenchText({
      rootPath: root,
      query: "foo\\((bar)\\)",
      replaceWith: "$1-$&",
      useRegex: true,
      files: [path.join(root, "a.ts")]
    });
    expect(result.totalReplaced).toBe(1);
    // $1 -> bar, $& -> foo(bar); the leading "$x" in the file stays untouched
    expect(fs.readFileSync(path.join(root, "a.ts"), "utf8")).toBe("bar-foo(bar) $x\n");
  });

  it("preserves CRLF line endings", async () => {
    const root = makeRoot();
    fs.writeFileSync(path.join(root, "a.ts"), "findme one\r\nfindme two\r\n", "utf8");

    const result = await replaceWorkbenchText({
      rootPath: root,
      query: "findme",
      replaceWith: "done",
      files: [path.join(root, "a.ts")]
    });
    expect(result.totalReplaced).toBe(2);
    const bytes = fs.readFileSync(path.join(root, "a.ts"));
    expect(bytes.toString("latin1")).toBe("done one\r\ndone two\r\n");
  });

  it("preserves BOM and UTF-16 encoding", async () => {
    const root = makeRoot();
    const bomUtf8 = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from("findme 内容\n", "utf8")
    ]);
    fs.writeFileSync(path.join(root, "a.ts"), bomUtf8);
    const utf16 = Buffer.concat([
      Buffer.from([0xff, 0xfe]),
      Buffer.from("findme second\n", "utf16le")
    ]);
    fs.writeFileSync(path.join(root, "b.ts"), utf16);

    const result = await replaceWorkbenchText({
      rootPath: root,
      query: "findme",
      replaceWith: "done",
      files: [path.join(root, "a.ts"), path.join(root, "b.ts")]
    });
    expect(result.totalReplaced).toBe(2);
    const a = fs.readFileSync(path.join(root, "a.ts"));
    expect(a.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))).toBe(true);
    expect(a.subarray(3).toString("utf8")).toBe("done 内容\n");
    const b = fs.readFileSync(path.join(root, "b.ts"));
    expect(b.subarray(0, 2).equals(Buffer.from([0xff, 0xfe]))).toBe(true);
    expect(b.subarray(2).toString("utf16le")).toBe("done second\n");
  });

  it("replaces a single selected occurrence by ordinal", async () => {
    const root = makeRoot();
    fs.writeFileSync(path.join(root, "a.ts"), "findme first\nfindme second\n", "utf8");

    const result = await replaceWorkbenchText({
      rootPath: root,
      query: "findme",
      replaceWith: "done",
      files: [path.join(root, "a.ts")],
      only: [{ path: path.join(root, "a.ts"), ordinal: 1 }]
    });
    expect(result.totalReplaced).toBe(1);
    expect(fs.readFileSync(path.join(root, "a.ts"), "utf8")).toBe("findme first\ndone second\n");
  });

  it("skips files outside the project root", async () => {
    const root = makeRoot();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "agent-resume-outside-"));
    roots.push(outside);
    fs.writeFileSync(path.join(outside, "a.ts"), "findme\n", "utf8");

    const result = await replaceWorkbenchText({
      rootPath: root,
      query: "findme",
      replaceWith: "done",
      files: [path.join(outside, "a.ts")]
    });
    expect(result.replaced).toEqual([]);
    expect(result.skipped[0].reason).toBe("invalid");
  });

  it("reports stale files that no longer contain the query", async () => {
    const root = makeRoot();
    fs.writeFileSync(path.join(root, "a.ts"), "changed since search\n", "utf8");

    const result = await replaceWorkbenchText({
      rootPath: root,
      query: "findme",
      replaceWith: "done",
      files: [path.join(root, "a.ts")]
    });
    expect(result.replaced).toEqual([]);
    expect(result.skipped).toEqual([{ path: "a.ts", reason: "stale" }]);
  });
});

describe("splitGlobList", () => {
  it("splits comma / newline separated patterns but keeps brace groups intact", () => {
    expect(splitGlobList("**/*.{ts,tsx}, src/**\n*.md")).toEqual([
      "**/*.{ts,tsx}",
      "src/**",
      "*.md"
    ]);
    expect(splitGlobList("  ,, *.ts ,")).toEqual(["*.ts"]);
    expect(splitGlobList(undefined)).toEqual([]);
  });
});

describe("workbenchSearchText include / exclude globs", () => {
  function fixture(): string {
    const root = makeRoot();
    const write = (rel: string, content = "needle here\n") => {
      const target = path.join(root, rel);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content, "utf8");
    };
    write("a.ts");
    write("b.md");
    write("c.test.ts");
    write("src/deep/d.ts");
    write("dist/out.js");
    write("node_modules/pkg/x.ts");
    return root;
  }

  function relativeMatches(matches: Array<{ relativePath: string }>): string[] {
    return [...new Set(matches.map((match) => match.relativePath))].sort();
  }

  it("searches everything except skip dirs by default", async () => {
    const root = fixture();
    const result = await searchWorkbenchText({ rootPath: root, query: "needle", timeBudgetMs: 5000 });
    expect(relativeMatches(result.matches)).toEqual([
      "a.ts",
      "b.md",
      "c.test.ts",
      "src/deep/d.ts"
    ]);
  });

  it("restricts results to files matching the include globs", async () => {
    const root = fixture();
    const ts = await searchWorkbenchText({
      rootPath: root,
      query: "needle",
      filesToInclude: "*.ts",
      timeBudgetMs: 5000
    });
    expect(relativeMatches(ts.matches)).toEqual(["a.ts", "c.test.ts", "src/deep/d.ts"]);

    const src = await searchWorkbenchText({
      rootPath: root,
      query: "needle",
      filesToInclude: "src/**",
      timeBudgetMs: 5000
    });
    expect(relativeMatches(src.matches)).toEqual(["src/deep/d.ts"]);
  });

  it("lets include globs reach build output dirs that are skipped by default", async () => {
    const root = fixture();
    const result = await searchWorkbenchText({
      rootPath: root,
      query: "needle",
      filesToInclude: "dist/**",
      timeBudgetMs: 5000
    });
    expect(relativeMatches(result.matches)).toEqual(["dist/out.js"]);
    // package stores stay excluded even with an explicit include
    expect(result.matches.some((match) => match.relativePath.includes("node_modules"))).toBe(false);
  });

  it("supports comma and newline separated exclude globs", async () => {
    const root = fixture();
    const result = await searchWorkbenchText({
      rootPath: root,
      query: "needle",
      filesToExclude: "**/*.test.ts,\n**/out.js",
      timeBudgetMs: 5000
    });
    expect(relativeMatches(result.matches)).toEqual(["a.ts", "b.md", "src/deep/d.ts"]);
  });

  it("excludes whole directories named in the exclude glob", async () => {
    const root = fixture();
    const byDirName = await searchWorkbenchText({
      rootPath: root,
      query: "needle",
      filesToExclude: "src",
      timeBudgetMs: 5000
    });
    expect(relativeMatches(byDirName.matches)).toEqual(["a.ts", "b.md", "c.test.ts"]);

    const byGlob = await searchWorkbenchText({
      rootPath: root,
      query: "needle",
      filesToInclude: "**/*.js, **/*.ts",
      filesToExclude: "dist/**",
      timeBudgetMs: 5000
    });
    expect(relativeMatches(byGlob.matches)).toEqual(["a.ts", "c.test.ts", "src/deep/d.ts"]);
  });
});
