import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  resetWorkbenchSearchStateForTests,
  searchWorkbenchText
} from "../dist/main/workbenchSearch.js";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "agent-resume-workbench-search-"));

try {
  fs.writeFileSync(path.join(root, "alpha.ts"), "const HelloWorld = 1;\nfindme line\n", "utf8");
  fs.writeFileSync(path.join(root, "beta.ts"), "no match here\nanother line\n", "utf8");
  fs.mkdirSync(path.join(root, "node_modules", "pkg"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "node_modules", "pkg", "hidden.ts"),
    "findme should be ignored\n",
    "utf8"
  );
  fs.mkdirSync(path.join(root, "dist"), { recursive: true });
  fs.writeFileSync(path.join(root, "dist", "built.js"), "findme in dist\n", "utf8");
  fs.writeFileSync(path.join(root, "binary.bin"), Buffer.from([0x00, 0x01, 0x02, 0x66, 0x69]));
  fs.writeFileSync(path.join(root, "case.txt"), "FindMe Case\n", "utf8");

  resetWorkbenchSearchStateForTests();

  const basic = await searchWorkbenchText({
    rootPath: root,
    query: "findme",
    // Force node path for deterministic ignore behavior in tests when rg is present:
    // still OK if rg is used — we exclude node_modules/dist via globs too.
    timeBudgetMs: 5000
  });
  assert.ok(basic.matches.length >= 1, "expected at least one match");
  assert.ok(
    basic.matches.every((m) => !m.relativePath.includes("node_modules")),
    "node_modules must be ignored"
  );
  assert.ok(
    basic.matches.every((m) => !m.relativePath.startsWith("dist/") && m.relativePath !== "dist"),
    "dist must be ignored"
  );
  assert.ok(
    basic.matches.some((m) => m.relativePath === "alpha.ts" && m.line === 2),
    "alpha.ts line 2 should match"
  );

  const caseSensitive = await searchWorkbenchText({
    rootPath: root,
    query: "FindMe",
    matchCase: true,
    timeBudgetMs: 5000
  });
  assert.ok(
    caseSensitive.matches.some((m) => m.relativePath === "case.txt"),
    "case-sensitive FindMe should hit case.txt"
  );
  assert.ok(
    !caseSensitive.matches.some((m) => m.relativePath === "alpha.ts"),
    "case-sensitive FindMe should not hit findme in alpha.ts"
  );

  const wholeWord = await searchWorkbenchText({
    rootPath: root,
    query: "Hello",
    wholeWord: true,
    matchCase: true,
    timeBudgetMs: 5000
  });
  // HelloWorld is one identifier; whole-word Hello should not match HelloWorld
  assert.ok(
    !wholeWord.matches.some((m) => m.relativePath === "alpha.ts" && m.preview.includes("HelloWorld")),
    "whole-word Hello should not match HelloWorld"
  );

  const capped = await searchWorkbenchText({
    rootPath: root,
    query: "line",
    maxResults: 1,
    timeBudgetMs: 5000
  });
  assert.equal(capped.matches.length, 1);
  assert.equal(capped.truncated, true);

  const empty = await searchWorkbenchText({ rootPath: root, query: "" });
  assert.deepEqual(empty.matches, []);

  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    () => searchWorkbenchText({ rootPath: root, query: "findme", signal: controller.signal }),
    (error) => error && error.name === "AbortError"
  );

  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "agent-resume-workbench-search-out-"));
  try {
    // Searching a valid root is fine; path escape is enforced when resolving root.
    const missing = path.join(outside, "does-not-exist");
    await assert.rejects(
      () => searchWorkbenchText({ rootPath: missing, query: "x" }),
      (error) => error instanceof Error && error.message.startsWith("工作目录不存在:") && !error.message.includes("ENOENT")
    );
  } finally {
    fs.rmSync(outside, { recursive: true, force: true });
  }

  console.log("workbench-search.test.mjs: all assertions passed");
} finally {
  resetWorkbenchSearchStateForTests();
  fs.rmSync(root, { recursive: true, force: true });
}
