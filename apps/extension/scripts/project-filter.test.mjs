#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildProjectFilterScope,
  buildProjectRootsSqlWhere,
  matchesProjectScope,
  noteMatchesProjectScope
} from "../out/filter/projectFilter.js";

test("matchesProjectScope handles exact, nested subdirectory, sibling, and prefix-collision paths", () => {
  const scope = buildProjectFilterScope(["/tmp/workspace/repo"]);

  assert.equal(matchesProjectScope("/tmp/workspace/repo", scope), true);
  assert.equal(matchesProjectScope("/tmp/workspace/repo/", scope), true);
  assert.equal(matchesProjectScope("/tmp/workspace/repo/apps/ext", scope), true);

  assert.equal(matchesProjectScope("/tmp/workspace/repo-2", scope), false);
  assert.equal(matchesProjectScope("/tmp/workspace/other", scope), false);
  assert.equal(matchesProjectScope("/tmp/workspace", scope), false);
  assert.equal(matchesProjectScope("", scope), false);
  assert.equal(matchesProjectScope(undefined, scope), false);
});

test("matchesProjectScope supports multi-root workspaces and empty scopes", () => {
  const multi = buildProjectFilterScope(["/tmp/ws-a", "/tmp/ws-b"]);
  assert.equal(matchesProjectScope("/tmp/ws-a/sub", multi), true);
  assert.equal(matchesProjectScope("/tmp/ws-b", multi), true);
  assert.equal(matchesProjectScope("/tmp/ws-c", multi), false);

  const empty = buildProjectFilterScope([]);
  assert.equal(matchesProjectScope("/tmp/ws-a", empty), false);
});

test("matchesProjectScope resolves symlinks cleanly", () => {
  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "arp-filter-test-"));
  try {
    const realDir = path.join(tmpBase, "real-repo");
    const linkDir = path.join(tmpBase, "link-repo");
    fs.mkdirSync(path.join(realDir, "nested"), { recursive: true });
    fs.symlinkSync(realDir, linkDir);

    const scopeFromLink = buildProjectFilterScope([linkDir]);
    assert.equal(matchesProjectScope(realDir, scopeFromLink), true);
    assert.equal(matchesProjectScope(path.join(realDir, "nested"), scopeFromLink), true);

    const scopeFromReal = buildProjectFilterScope([realDir]);
    assert.equal(matchesProjectScope(linkDir, scopeFromReal), true);
    assert.equal(matchesProjectScope(path.join(linkDir, "nested"), scopeFromReal), true);
  } finally {
    fs.rmSync(tmpBase, { recursive: true, force: true });
  }
});

test("buildProjectRootsSqlWhere returns 0 for empty scope and escapes %, _, and quotes", () => {
  const escapeSql = (v) => v.replaceAll("'", "''");
  const empty = buildProjectFilterScope([]);
  assert.equal(buildProjectRootsSqlWhere("s", empty, escapeSql), "0");

  const scope = buildProjectFilterScope(["/tmp/100%_o'hare"]);
  const sql = buildProjectRootsSqlWhere("s", scope, escapeSql);
  assert.match(sql, /s\.project_path.*= '\/tmp\/100%_o''hare'/);
  assert.match(sql, /s\.project_path.*LIKE '\/tmp\/100\\%\\_o''hare\/%' ESCAPE '\\'/);
});

test("noteMatchesProjectScope filters project, session, and library notes", () => {
  const scope = buildProjectFilterScope(["/tmp/ws/proj-a"]);
  const base = {
    noteId: "n1",
    filename: "note.md",
    relDir: "dir",
    relMdPath: "dir/note.md",
    createdAtMs: 1,
    updatedAtMs: 1
  };

  assert.equal(
    noteMatchesProjectScope({ ...base, scope: "project", projectPath: "/tmp/ws/proj-a/sub" }, scope),
    true
  );
  assert.equal(
    noteMatchesProjectScope({ ...base, scope: "project", projectPath: "/tmp/ws/proj-b" }, scope),
    false
  );

  assert.equal(
    noteMatchesProjectScope(
      { ...base, scope: "session", provider: "codex", agentSessionId: "s1", projectPath: "/tmp/ws/proj-a" },
      scope
    ),
    true
  );
  assert.equal(
    noteMatchesProjectScope(
      { ...base, scope: "session", provider: "codex", agentSessionId: "s2" },
      scope,
      (provider, id) => (provider === "codex" && id === "s2" ? "/tmp/ws/proj-a/packages/core" : undefined)
    ),
    true
  );
  assert.equal(
    noteMatchesProjectScope(
      { ...base, scope: "session", provider: "codex", agentSessionId: "s3" },
      scope,
      () => "/tmp/ws/proj-other"
    ),
    false
  );

  assert.equal(
    noteMatchesProjectScope({ ...base, scope: "library" }, scope),
    false
  );
  assert.equal(
    noteMatchesProjectScope(
      { ...base, scope: "library", work: { primaryProject: "/tmp/ws/proj-a" } },
      scope
    ),
    true
  );
  assert.equal(
    noteMatchesProjectScope(
      { ...base, scope: "library", work: { projects: ["/tmp/ws/proj-b", "/tmp/ws/proj-a/sub"] } },
      scope
    ),
    true
  );
  assert.equal(
    noteMatchesProjectScope(
      { ...base, scope: "library", work: { primaryProject: "/tmp/ws/proj-b" } },
      scope
    ),
    false
  );
});
