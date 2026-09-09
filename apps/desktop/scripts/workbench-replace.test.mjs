import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { replaceWorkbenchText } from "../dist/main/workbenchReplace.js";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "agent-resume-workbench-replace-"));
const file = path.join(root, "a.ts");

try {
  fs.writeFileSync(file, "findme one\nskip line\nfindme two\n", "utf8");
  fs.writeFileSync(path.join(root, "b.test.ts"), "findme in test\n", "utf8");

  // Regex replacement with a backreference; only targets the listed files.
  const result = await replaceWorkbenchText({
    rootPath: root,
    query: "findme (one|two)",
    replaceWith: "done $1",
    useRegex: true,
    files: [file]
  });
  assert.equal(result.totalReplaced, 2, "expected 2 replacements");
  assert.deepEqual(
    fs.readFileSync(file, "utf8"),
    "done one\nskip line\ndone two\n",
    "regex replace with capture group must rewrite the file"
  );

  // Single-occurrence replacement via ordinal.
  fs.writeFileSync(file, "findme\nfindme\n", "utf8");
  const single = await replaceWorkbenchText({
    rootPath: root,
    query: "findme",
    replaceWith: "done",
    files: [file],
    only: [{ path: file, ordinal: 1 }]
  });
  assert.equal(single.totalReplaced, 1, "expected exactly one replacement");
  assert.deepEqual(fs.readFileSync(file, "utf8"), "findme\ndone\n", "ordinal replace must hit the second line");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log("workbench-replace.test.mjs: all assertions passed");
