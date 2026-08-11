import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  ensureExtensionCatalogSchema,
  ensureProjectForPath,
  hideProjectInCatalog,
  listProjects,
  loadProjectAliasesMap,
  reconcileProjectsFromSessions,
  runSqlite,
  setProjectAliasInCatalog,
  setProjectLocalPath,
  setProjectPinnedInCatalog,
  mergeProjectsInCatalog,
  splitProjectPathInCatalog,
  isForeignUserPath,
  toPortableKey
} from "../dist/index.js";

test("toPortableKey maps foreign user homes to ~/…", () => {
  const home = os.homedir();
  const foreign = path.join(path.dirname(home), "other-user", "work", "panel");
  assert.equal(toPortableKey(foreign), "~/work/panel");
  assert.equal(toPortableKey(path.join(home, "work", "panel")), "~/work/panel");
});

test("projects reconcile merges paths by portable key and hide cascades sessions", async () => {
  const panelHome = await fs.mkdtemp(path.join(os.tmpdir(), "agent-resume-projects-"));
  const dbPath = path.join(panelHome, "catalog.db");
  const home = os.homedir();
  const pathA = path.join(path.dirname(home), "lucas", "demo-proj");
  const pathB = path.join(home, "demo-proj");

  try {
    await ensureExtensionCatalogSchema(dbPath);
    const now = Date.now();
    await runSqlite(
      dbPath,
      `INSERT INTO sessions (provider, agent_session_id, title, project_path, updated_at_ms, archived, hidden)
       VALUES
         ('codex', 's-a', 'A session', '${pathA.replaceAll("'", "''")}', ${now}, 0, 0),
         ('codex', 's-b', 'B session', '${pathB.replaceAll("'", "''")}', ${now}, 0, 0);`
    );

    const result = await reconcileProjectsFromSessions(dbPath);
    assert.ok(result.projectCount >= 1);

    const projects = await listProjects(dbPath);
    const merged = projects.filter((p) => p.portableKey === "~/demo-proj");
    assert.equal(merged.length, 1, "lucas/john-style paths should merge into one project");
    assert.equal(merged[0].sessionCount, 2);

    await setProjectAliasInCatalog(dbPath, pathB, "Demo");
    const aliases = await loadProjectAliasesMap(dbPath);
    assert.equal(aliases[pathB] || aliases[toPortableKey(pathB)], "Demo");

    // Clearing alias keeps the project row
    await setProjectAliasInCatalog(dbPath, pathB, "");
    const stillThere = await listProjects(dbPath);
    assert.ok(stillThere.some((p) => p.projectId === merged[0].projectId));

    await setProjectAliasInCatalog(dbPath, pathB, "Demo");
    const hide = await hideProjectInCatalog(dbPath, merged[0].projectId);
    assert.ok(hide.hiddenSessions >= 2);

    const afterHide = await listProjects(dbPath);
    assert.ok(!afterHide.some((p) => p.projectId === merged[0].projectId));

    const visible = await runSqlite(
      dbPath,
      `SELECT COUNT(*) AS c FROM sessions WHERE hidden = 0;`
    );
    // runSqlite returns text; use listProjects session counts via sql json
    const { runSqliteJson } = await import("../dist/index.js");
    const counts = await runSqliteJson(dbPath, `SELECT COUNT(*) AS c FROM sessions WHERE hidden = 0;`);
    assert.equal(Number(counts[0].c), 0);
  } finally {
    await fs.rm(panelHome, { recursive: true, force: true });
  }
});

test("isForeignUserPath detects other user home paths", () => {
  const home = os.homedir();
  assert.equal(isForeignUserPath(path.join(home, "app")), false);
  const foreign = path.join(path.dirname(home), "other-user", "app");
  assert.equal(isForeignUserPath(foreign), true);
});

test("mergeProjectsInCatalog reassigns sessions and removes source", async () => {
  const panelHome = await fs.mkdtemp(path.join(os.tmpdir(), "agent-resume-merge-"));
  const dbPath = path.join(panelHome, "catalog.db");
  const pathA = path.join(os.homedir(), "merge-a");
  const pathB = path.join(os.homedir(), "merge-b");
  try {
    await ensureExtensionCatalogSchema(dbPath);
    const now = Date.now();
    await runSqlite(
      dbPath,
      `INSERT INTO sessions (provider, agent_session_id, title, project_path, updated_at_ms, archived, hidden)
       VALUES
         ('codex', 'm-a', 'A', '${pathA.replaceAll("'", "''")}', ${now}, 0, 0),
         ('codex', 'm-b', 'B', '${pathB.replaceAll("'", "''")}', ${now}, 0, 0);`
    );
    await reconcileProjectsFromSessions(dbPath);
    const projects = await listProjects(dbPath);
    const a = projects.find((p) => p.portableKey === toPortableKey(pathA));
    const b = projects.find((p) => p.portableKey === toPortableKey(pathB));
    assert.ok(a && b && a.projectId !== b.projectId);
    const result = await mergeProjectsInCatalog(dbPath, a.projectId, b.projectId);
    assert.equal(result.targetProjectId, b.projectId);
    assert.ok(result.mergedSessions >= 1);
    const after = await listProjects(dbPath);
    assert.ok(!after.some((p) => p.projectId === a.projectId));
    assert.ok(after.some((p) => p.projectId === b.projectId));
    const { runSqliteJson } = await import("../dist/index.js");
    const linked = await runSqliteJson(
      dbPath,
      `SELECT COUNT(*) AS c FROM sessions WHERE project_id = '${b.projectId}';`
    );
    assert.equal(Number(linked[0].c), 2);
  } finally {
    await fs.rm(panelHome, { recursive: true, force: true });
  }
});

test("merge survives reconcile: merged sessions stay in target, source not re-created", async () => {
  const panelHome = await fs.mkdtemp(path.join(os.tmpdir(), "agent-resume-merge-reconcile-"));
  const dbPath = path.join(panelHome, "catalog.db");
  const pathA = path.join(os.homedir(), "merge-a");
  const pathB = path.join(os.homedir(), "merge-b");
  try {
    await ensureExtensionCatalogSchema(dbPath);
    const now = Date.now();
    await runSqlite(
      dbPath,
      `INSERT INTO sessions (provider, agent_session_id, title, project_path, updated_at_ms, archived, hidden)
       VALUES
         ('codex', 'm-a', 'A', '${pathA.replaceAll("'", "''")}', ${now}, 0, 0),
         ('codex', 'm-b', 'B', '${pathB.replaceAll("'", "''")}', ${now}, 0, 0);`
    );
    await reconcileProjectsFromSessions(dbPath);
    const projects = await listProjects(dbPath);
    const a = projects.find((p) => p.portableKey === toPortableKey(pathA));
    const b = projects.find((p) => p.portableKey === toPortableKey(pathB));
    assert.ok(a && b && a.projectId !== b.projectId);

    await mergeProjectsInCatalog(dbPath, a.projectId, b.projectId);

    // Periodic session sync re-runs reconcile. The absorbed source path is now
    // a local path of the target, so it must resolve back to the target instead
    // of re-creating the merged-away project and pulling sessions back out.
    await reconcileProjectsFromSessions(dbPath);
    const after = await listProjects(dbPath);
    assert.ok(!after.some((p) => p.portableKey === toPortableKey(pathA)), "source project must not be re-created");
    assert.ok(after.some((p) => p.projectId === b.projectId));
    const { runSqliteJson } = await import("../dist/index.js");
    const linked = await runSqliteJson(
      dbPath,
      `SELECT COUNT(*) AS c FROM sessions WHERE project_id = '${b.projectId}';`
    );
    assert.equal(Number(linked[0].c), 2, "merged sessions must stay in target after reconcile");
  } finally {
    await fs.rm(panelHome, { recursive: true, force: true });
  }
});

test("chained merges keep every absorbed session in the final target", async () => {
  const panelHome = await fs.mkdtemp(path.join(os.tmpdir(), "agent-resume-chain-"));
  const dbPath = path.join(panelHome, "catalog.db");
  const pathA = path.join(os.homedir(), "chain-a");
  const pathB = path.join(os.homedir(), "chain-b");
  const pathC = path.join(os.homedir(), "chain-c");
  try {
    await ensureExtensionCatalogSchema(dbPath);
    const now = Date.now();
    await runSqlite(
      dbPath,
      `INSERT INTO sessions (provider, agent_session_id, title, project_path, updated_at_ms, archived, hidden)
       VALUES
         ('codex', 'c-a', 'A', '${pathA.replaceAll("'", "''")}', ${now}, 0, 0),
         ('codex', 'c-b', 'B', '${pathB.replaceAll("'", "''")}', ${now}, 0, 0),
         ('codex', 'c-c', 'C', '${pathC.replaceAll("'", "''")}', ${now}, 0, 0);`
    );
    await reconcileProjectsFromSessions(dbPath);
    const projects = await listProjects(dbPath);
    const a = projects.find((p) => p.portableKey === toPortableKey(pathA));
    const b = projects.find((p) => p.portableKey === toPortableKey(pathB));
    const c = projects.find((p) => p.portableKey === toPortableKey(pathC));
    assert.ok(a && b && c);

    // Two merges into the same target: the second must not clobber the first.
    await mergeProjectsInCatalog(dbPath, a.projectId, b.projectId);
    await mergeProjectsInCatalog(dbPath, c.projectId, b.projectId);
    await reconcileProjectsFromSessions(dbPath);

    const after = await listProjects(dbPath);
    assert.ok(!after.some((p) => p.portableKey === toPortableKey(pathA)), "first source must not be re-created");
    assert.ok(!after.some((p) => p.portableKey === toPortableKey(pathC)), "second source must not be re-created");
    const { runSqliteJson } = await import("../dist/index.js");
    const linked = await runSqliteJson(
      dbPath,
      `SELECT COUNT(*) AS c FROM sessions WHERE project_id = '${b.projectId}';`
    );
    assert.equal(Number(linked[0].c), 3, "all sessions must stay in the final target after reconcile");
  } finally {
    await fs.rm(panelHome, { recursive: true, force: true });
  }
});

test("splitProjectPathInCatalog peels a different portable key path", async () => {
  const panelHome = await fs.mkdtemp(path.join(os.tmpdir(), "agent-resume-split-"));
  const dbPath = path.join(panelHome, "catalog.db");
  const pathA = path.join(os.homedir(), "split-a");
  const pathB = path.join(os.homedir(), "split-b");
  try {
    await ensureExtensionCatalogSchema(dbPath);
    const now = Date.now();
    await runSqlite(
      dbPath,
      `INSERT INTO sessions (provider, agent_session_id, title, project_path, updated_at_ms, archived, hidden)
       VALUES
         ('codex', 'sp-a', 'A', '${pathA.replaceAll("'", "''")}', ${now}, 0, 0),
         ('codex', 'sp-b', 'B', '${pathB.replaceAll("'", "''")}', ${now}, 0, 0);`
    );
    await reconcileProjectsFromSessions(dbPath);
    let projects = await listProjects(dbPath);
    const a = projects.find((p) => p.portableKey === toPortableKey(pathA));
    const b = projects.find((p) => p.portableKey === toPortableKey(pathB));
    assert.ok(a && b);
    await mergeProjectsInCatalog(dbPath, a.projectId, b.projectId);
    const split = await splitProjectPathInCatalog(dbPath, b.projectId, pathA);
    assert.ok(split.movedSessions >= 1);
    assert.notEqual(split.projectId, b.projectId);
    projects = await listProjects(dbPath);
    assert.ok(projects.some((p) => p.projectId === split.projectId));
    assert.ok(projects.some((p) => p.projectId === b.projectId));
  } finally {
    await fs.rm(panelHome, { recursive: true, force: true });
  }
});

test("listProjects recovers when machine local_paths row is stale", async () => {
  const panelHome = await fs.mkdtemp(path.join(os.tmpdir(), "agent-resume-stale-local-"));
  const dbPath = path.join(panelHome, "catalog.db");
  const realDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-resume-real-proj-"));
  try {
    await ensureExtensionCatalogSchema(dbPath);
    const projectId = await ensureProjectForPath(dbPath, realDir);
    // Overwrite this machine's local path with a non-existent directory
    const { getMachineId } = await import("../dist/index.js");
    const machineId = await getMachineId();
    const ghost = path.join(os.tmpdir(), `ghost-missing-${Date.now()}`);
    await runSqlite(
      dbPath,
      `INSERT INTO project_local_paths (project_id, machine_id, absolute_path, updated_at_ms)
       VALUES ('${projectId}', '${machineId}', '${ghost.replaceAll("'", "''")}', ${Date.now()})
       ON CONFLICT(project_id, machine_id) DO UPDATE SET
         absolute_path = excluded.absolute_path,
         updated_at_ms = excluded.updated_at_ms;`
    );
    // Also set portable_key so expandPortableKey won't match tmp dir — use abs: key via raw update
    // ensureProjectForPath used abs or home path; for tmp paths portable is often abs:...
    const projects = await listProjects(dbPath);
    const row = projects.find((p) => p.projectId === projectId);
    assert.ok(row);
    // Real directory must be recovered via session path or rehome of stored paths —
    // we need a session pointing at realDir for session-path fallback.
    await runSqlite(
      dbPath,
      `INSERT INTO sessions (provider, agent_session_id, title, project_path, updated_at_ms, archived, hidden, project_id)
       VALUES ('codex', 'stale-1', 'S', '${realDir.replaceAll("'", "''")}', ${Date.now()}, 0, 0, '${projectId}');`
    );
    const after = await listProjects(dbPath);
    const fixed = after.find((p) => p.projectId === projectId);
    assert.ok(fixed);
    assert.equal(fixed.pathMissing, false);
    assert.equal(path.resolve(fixed.localPath || ""), path.resolve(realDir));
  } finally {
    await fs.rm(panelHome, { recursive: true, force: true });
    await fs.rm(realDir, { recursive: true, force: true });
  }
});

test("project pin and local path binding persist on catalog projects", async () => {
  const panelHome = await fs.mkdtemp(path.join(os.tmpdir(), "agent-resume-projects-pin-"));
  const dbPath = path.join(panelHome, "catalog.db");
  const homePath = path.join(os.homedir(), "pin-app");
  try {
    await ensureExtensionCatalogSchema(dbPath);
    const projectId = await ensureProjectForPath(dbPath, homePath);
    await setProjectPinnedInCatalog(dbPath, projectId, true);
    const otherDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-resume-bind-"));
    await setProjectLocalPath(dbPath, projectId, otherDir);
    const projects = await listProjects(dbPath);
    const row = projects.find((p) => p.projectId === projectId);
    assert.ok(row);
    assert.equal(row.pinned, true);
    assert.equal(row.localPath, path.resolve(otherDir));
    assert.equal(row.pathMissing, false);
  } finally {
    await fs.rm(panelHome, { recursive: true, force: true });
  }
});

test("legacy projects(project_path) table migrates to project_id schema", async () => {
  const panelHome = await fs.mkdtemp(path.join(os.tmpdir(), "agent-resume-projects-legacy-"));
  const dbPath = path.join(panelHome, "catalog.db");
  try {
    await runSqlite(
      dbPath,
      `CREATE TABLE projects (
         project_path TEXT PRIMARY KEY,
         alias TEXT NOT NULL,
         updated_at_ms INTEGER NOT NULL
       );
       CREATE TABLE sessions (
         provider TEXT NOT NULL,
         agent_session_id TEXT NOT NULL,
         title TEXT NOT NULL,
         project_path TEXT NOT NULL,
         updated_at_ms INTEGER NOT NULL,
         archived INTEGER NOT NULL DEFAULT 0,
         hidden INTEGER NOT NULL DEFAULT 0,
         PRIMARY KEY (provider, agent_session_id)
       );`
    );
    const homePath = path.join(os.homedir(), "legacy-app");
    await runSqlite(
      dbPath,
      `INSERT INTO projects (project_path, alias, updated_at_ms)
       VALUES ('${homePath.replaceAll("'", "''")}', 'Legacy', ${Date.now()});
       INSERT INTO sessions (provider, agent_session_id, title, project_path, updated_at_ms, archived, hidden)
       VALUES ('codex', 'legacy-1', 'L', '${homePath.replaceAll("'", "''")}', ${Date.now()}, 0, 0);`
    );

    await ensureExtensionCatalogSchema(dbPath);
    await reconcileProjectsFromSessions(dbPath);
    const projects = await listProjects(dbPath);
    assert.ok(projects.some((p) => p.alias === "Legacy" || p.portableKey === toPortableKey(homePath)));
    const id = await ensureProjectForPath(dbPath, homePath);
    assert.ok(id);
  } finally {
    await fs.rm(panelHome, { recursive: true, force: true });
  }
});
