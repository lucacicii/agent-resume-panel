#!/usr/bin/env node

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const require = createRequire(import.meta.url);

const { ensureCatalogSchema } = require("../out/catalog/db.js");
const {
  loadProjectAliasesMap,
  getProjectAliasFromCatalog,
  setProjectAliasInCatalog,
  upsertProjectAliasesBatch
} = require("../out/catalog/projects.js");

const tempDir = await mkdtemp(join(tmpdir(), "agent-resume-panel-alias-"));
const dbPath = join(tempDir, "catalog.db");

try {
  await ensureCatalogSchema(dbPath);

  await setProjectAliasInCatalog(dbPath, "/tmp/foo/bar", "  My Alias  ");
  assert.equal(await getProjectAliasFromCatalog(dbPath, "/tmp/foo/bar"), "My Alias");

  const map = await loadProjectAliasesMap(dbPath);
  assert.equal(map[join("/tmp/foo/bar")], "My Alias");

  await upsertProjectAliasesBatch(dbPath, [
    { projectPath: "/tmp/other", alias: "Other" },
    { projectPath: "/tmp/foo/bar", alias: "Updated" }
  ]);
  const merged = await loadProjectAliasesMap(dbPath);
  assert.equal(merged[join("/tmp/other")], "Other");
  assert.equal(merged[join("/tmp/foo/bar")], "Updated");

  await setProjectAliasInCatalog(dbPath, "/tmp/foo/bar", "");
  assert.equal(await getProjectAliasFromCatalog(dbPath, "/tmp/foo/bar"), undefined);
  const afterClear = await loadProjectAliasesMap(dbPath);
  assert.equal(afterClear[join("/tmp/foo/bar")], undefined);
  assert.equal(afterClear[join("/tmp/other")], "Other");

  console.log("project-alias-catalog.test.mjs: all assertions passed");
} finally {
  await rm(tempDir, { recursive: true, force: true });
}