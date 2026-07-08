#!/usr/bin/env node

import assert from "node:assert/strict";

const NOTE_FILE_NAME = "note.md";

function encodeProjectPath(projectPath) {
  return Buffer.from(projectPath, "utf8").toString("base64url");
}

function decodeProjectPath(encoded) {
  return Buffer.from(encoded, "base64url").toString("utf8");
}

function parseNotePath(path) {
  const segments = path.split("/").filter(Boolean);
  if (segments.length < 3 || segments[segments.length - 1] !== NOTE_FILE_NAME) {
    return undefined;
  }

  if (segments[0] === "session") {
    if (segments.length !== 4) {
      return undefined;
    }
    return {
      kind: "session",
      provider: decodeURIComponent(segments[1]),
      sessionId: decodeURIComponent(segments[2])
    };
  }

  if (segments[0] === "project") {
    if (segments.length !== 3) {
      return undefined;
    }
    const projectPath = decodeProjectPath(segments[1]);
    if (!projectPath) {
      return undefined;
    }
    return { kind: "project", projectPath };
  }

  return undefined;
}

const projectPath = "/Users/me/work/agent-resume-panel";
const encoded = encodeProjectPath(projectPath);
const projectNotePath = `/project/${encoded}/${NOTE_FILE_NAME}`;
assert.equal(parseNotePath(projectNotePath)?.kind, "project");
assert.equal(parseNotePath(projectNotePath)?.projectPath, projectPath);

const sessionNotePath = `/session/${encodeURIComponent("codex")}/${encodeURIComponent("session-123")}/${NOTE_FILE_NAME}`;
assert.deepEqual(parseNotePath(sessionNotePath), {
  kind: "session",
  provider: "codex",
  sessionId: "session-123"
});

console.log("note-uri.test.mjs: all assertions passed");