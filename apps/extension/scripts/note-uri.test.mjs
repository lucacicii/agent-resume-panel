#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import path from "node:path";

// --- naming (mirrors src/notes/noteNaming.ts) ---
const NOTE_FILENAME_RE = /^(\d{4}-\d{2}-\d{2})-(\d+)\.md$/;

function localDateString(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatNoteFilename(dateStr, sequence) {
  const width = sequence < 100 ? 2 : String(sequence).length;
  return `${dateStr}-${String(sequence).padStart(width, "0")}.md`;
}

function nextNoteFilename(existingFilenames, date = new Date()) {
  const dateStr = localDateString(date);
  let max = 0;
  for (const name of existingFilenames) {
    const match = NOTE_FILENAME_RE.exec(name);
    if (!match || match[1] !== dateStr) {
      continue;
    }
    const n = Number.parseInt(match[2], 10);
    if (Number.isFinite(n) && n > max) {
      max = n;
    }
  }
  return formatNoteFilename(dateStr, max + 1);
}

function noteAssetsDirName(filename) {
  const stem = filename.endsWith(".md") ? filename.slice(0, -3) : filename;
  return `${stem}.assets`;
}

// --- paths (mirrors notesPaths projectDirKey / sessionDirKey) ---
function projectDirKey(projectPath) {
  const base =
    path
      .basename(projectPath)
      .replace(/[^a-zA-Z0-9._-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40) || "project";
  const hash = createHash("sha256").update(projectPath).digest("hex").slice(0, 8);
  return `${base}__${hash}`;
}

function sessionDirKey(sessionId) {
  return Buffer.from(sessionId, "utf8").toString("base64url");
}

// --- frontmatter ---
const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

function parseNoteDocument(raw) {
  const match = FM_RE.exec(raw);
  if (!match) {
    return { frontmatter: {}, body: raw };
  }
  const fm = {};
  for (const line of match[1].split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    fm[key] = value;
  }
  return { frontmatter: fm, body: match[2] };
}

const day = new Date(2026, 6, 8); // local Jul 8 2026
assert.equal(localDateString(day), "2026-07-08");
assert.equal(nextNoteFilename([], day), "2026-07-08-01.md");
assert.equal(nextNoteFilename(["2026-07-08-01.md"], day), "2026-07-08-02.md");
assert.equal(
  nextNoteFilename(["2026-07-08-01.md", "2026-07-08-02.md", "2026-07-07-99.md"], day),
  "2026-07-08-03.md"
);
assert.equal(noteAssetsDirName("2026-07-08-01.md"), "2026-07-08-01.assets");

function normalizeNoteFilename(input) {
  let name = input.trim();
  if (!name) return undefined;
  name = name.replace(/\\/g, "/").split("/").pop() ?? name;
  if (!name.toLowerCase().endsWith(".md")) name = `${name}.md`;
  const stem = name.endsWith(".md") ? name.slice(0, -3) : name;
  if (!stem || stem === "." || stem === "..") return undefined;
  const safeStem = stem
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/\.+$/g, "")
    .trim();
  if (!safeStem) return undefined;
  return `${safeStem}.md`;
}

function rewriteAssetReferences(content, oldFilename, newFilename) {
  const oldAssets = noteAssetsDirName(oldFilename);
  const newAssets = noteAssetsDirName(newFilename);
  if (oldAssets === newAssets) return content;
  return content.split(oldAssets).join(newAssets);
}

assert.equal(normalizeNoteFilename("  My Note  "), "My Note.md");
assert.equal(normalizeNoteFilename("plan.md"), "plan.md");
assert.equal(normalizeNoteFilename("a/b"), "b.md");
assert.equal(
  rewriteAssetReferences("![](./2026-07-08-01.assets/x.png)", "2026-07-08-01.md", "plan.md"),
  "![](./plan.assets/x.png)"
);

const projectPath = "/Users/me/work/agent-resume-panel";
const key = projectDirKey(projectPath);
assert.match(key, /^agent-resume-panel__[a-f0-9]{8}$/);
assert.equal(sessionDirKey("session-123"), Buffer.from("session-123", "utf8").toString("base64url"));

const doc = parseNoteDocument(`---
id: abc
scope: project
projectPath: ${projectPath}
---

# Hello

body`);
assert.equal(doc.frontmatter.id, "abc");
assert.equal(doc.frontmatter.scope, "project");
assert.match(doc.body, /# Hello/);

console.log("note-uri.test.mjs: all assertions passed");
