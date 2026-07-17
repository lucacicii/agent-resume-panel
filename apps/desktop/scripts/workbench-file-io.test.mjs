import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  MAX_WORKBENCH_EDIT_BYTES,
  inspectWorkbenchFile,
  resolveCanonicalWorkbenchPath,
  saveWorkbenchFile
} from "../dist/main/workbenchFileIo.js";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "agent-resume-workbench-file-"));
const outside = fs.mkdtempSync(path.join(os.tmpdir(), "agent-resume-workbench-outside-"));

try {
  const utf8Path = path.join(root, "sample.ts");
  fs.writeFileSync(utf8Path, "const value = 1;\n", "utf8");
  const utf8 = inspectWorkbenchFile(root, utf8Path);
  assert.equal(utf8.kind, "text");
  assert.equal(utf8.encoding, "utf8");
  assert.equal(utf8.content, "const value = 1;\n");

  const saved = saveWorkbenchFile(root, utf8Path, "const value = 2;\n", "utf8", utf8.version);
  assert.equal(saved.ok, true);
  assert.equal(fs.readFileSync(utf8Path, "utf8"), "const value = 2;\n");

  fs.writeFileSync(utf8Path, "external change\n", "utf8");
  const conflict = saveWorkbenchFile(root, utf8Path, "local change\n", "utf8", saved.version);
  assert.deepEqual(conflict.ok, false);
  assert.equal(conflict.reason, "conflict");
  assert.equal(fs.readFileSync(utf8Path, "utf8"), "external change\n");

  const forced = saveWorkbenchFile(root, utf8Path, "forced\n", "utf8", saved.version, true);
  assert.equal(forced.ok, true);
  assert.equal(fs.readFileSync(utf8Path, "utf8"), "forced\n");

  const bomPath = path.join(root, "bom.txt");
  fs.writeFileSync(bomPath, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("hello")]));
  const bom = inspectWorkbenchFile(root, bomPath);
  assert.equal(bom.kind, "text");
  assert.equal(bom.encoding, "utf8-bom");
  const bomSaved = saveWorkbenchFile(root, bomPath, "world", bom.encoding, bom.version);
  assert.equal(bomSaved.ok, true);
  assert.deepEqual([...fs.readFileSync(bomPath).subarray(0, 3)], [0xef, 0xbb, 0xbf]);

  const utf16Path = path.join(root, "utf16.txt");
  fs.writeFileSync(utf16Path, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("hello", "utf16le")]));
  const utf16 = inspectWorkbenchFile(root, utf16Path);
  assert.equal(utf16.kind, "text");
  assert.equal(utf16.encoding, "utf16le");
  assert.equal(utf16.content, "hello");

  const binaryPath = path.join(root, "image.bin");
  fs.writeFileSync(binaryPath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3]));
  assert.equal(inspectWorkbenchFile(root, binaryPath).kind, "external");
  assert.equal(inspectWorkbenchFile(root, binaryPath).reason, "binary");

  const largePath = path.join(root, "large.txt");
  fs.writeFileSync(largePath, Buffer.alloc(MAX_WORKBENCH_EDIT_BYTES + 1, 0x61));
  const large = inspectWorkbenchFile(root, largePath);
  assert.equal(large.kind, "external");
  assert.equal(large.reason, "too-large");

  const outsidePath = path.join(outside, "outside.txt");
  fs.writeFileSync(outsidePath, "outside", "utf8");
  assert.throws(() => resolveCanonicalWorkbenchPath(root, outsidePath), /路径超出允许范围/);

  const symlinkPath = path.join(root, "outside-link.txt");
  fs.symlinkSync(outsidePath, symlinkPath);
  assert.throws(() => inspectWorkbenchFile(root, symlinkPath), /路径超出允许范围/);

  console.log("workbench-file-io.test.mjs: all assertions passed");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(outside, { recursive: true, force: true });
}
