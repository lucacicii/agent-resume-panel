import * as fs from "node:fs/promises";
import * as path from "node:path";
import { runSqliteJson, escapeSqlLiteral } from "../sqlite";
import { readJsonLines } from "../transcript/jsonl";
import { findFilesByName, listJsonlFiles } from "../transcript/fs";
import { candidateAgyRoots } from "../transcript/agyRoots";
import type { AgentProvider } from "../catalog/types";
import type { PreviewHomes } from "../transcript/types";

export type NativeCwdUpdateReason = "ok" | "unchanged" | "not-found" | "unsupported-provider";

export interface NativeCwdUpdateResult {
  ok: boolean;
  reason: NativeCwdUpdateReason;
}

/**
 * Physically rewrite the provider's stored working directory for one session so
 * the next catalog sync converges native_project_path (and project_path, by the
 * value rule) onto the target. Best-effort: any provider failure returns
 * ok:false and the caller falls back to a catalog-only move — the two-layer
 * mechanism then keeps the user assignment sticky.
 */
export async function updateNativeSessionCwd(
  provider: AgentProvider,
  sessionId: string,
  targetPath: string,
  homes: PreviewHomes
): Promise<NativeCwdUpdateResult> {
  const id = sessionId?.trim();
  const target = targetPath?.trim();
  if (!id || !target) {
    return { ok: false, reason: "not-found" };
  }
  switch (provider) {
    case "codex":
      return updateCodexCwd(homes.codexHome, id, target);
    case "grok":
      return updateGrokCwd(homes.grokHome, id, target);
    case "opencode":
      return updateOpenCodeCwd(homes.opencodeHome, id, target);
    case "agy":
      return updateAgyCwd(homes.antigravityHome, id, target);
    case "cursor":
      return updateCursorCwd(homes.cursorHome, id, target);
    case "claude":
      return updateClaudeCwd(homes.claudeHome, id, target);
    case "pi":
      return updatePiPrimeCwd(homes.piHome, id, target);
    case "prime":
      return updatePiPrimeCwd(homes.primeHome, id, target);
    default:
      return { ok: false, reason: "unsupported-provider" };
  }
}

/** Codex stores session cwd in its latest state_*.sqlite threads table. */
async function updateCodexCwd(
  codexHome: string,
  sessionId: string,
  target: string
): Promise<NativeCwdUpdateResult> {
  let entries: string[];
  try {
    entries = await fs.readdir(codexHome);
  } catch {
    return { ok: false, reason: "not-found" };
  }
  const dbs = entries.filter((name) => /^state_\d+\.sqlite$/.test(name));
  if (!dbs.length) {
    return { ok: false, reason: "not-found" };
  }
  const stats = await Promise.all(
    dbs.map(async (name) => ({
      name,
      mtime: (await fs.stat(path.join(codexHome, name))).mtimeMs
    }))
  );
  const dbPath = path.join(codexHome, stats.sort((a, b) => b.mtime - a.mtime)[0].name);
  const rows = await runSqliteJson<{ c: number }>(
    dbPath,
    `UPDATE threads SET cwd = '${escapeSqlLiteral(target)}'
     WHERE id = '${escapeSqlLiteral(sessionId)}';
     SELECT changes() AS c;`
  );
  if (!Number(rows[0]?.c)) {
    return { ok: false, reason: "not-found" };
  }
  return { ok: true, reason: "ok" };
}

/** Grok stores cwd in sessions/<group>/<id>/summary.json → info.cwd. */
async function updateGrokCwd(
  grokHome: string,
  sessionId: string,
  target: string
): Promise<NativeCwdUpdateResult> {
  const files = await findFilesByName(path.join(grokHome, "sessions"), "summary.json");
  for (const file of files) {
    let row: Record<string, any>;
    try {
      row = JSON.parse(await fs.readFile(file, "utf8"));
    } catch {
      continue;
    }
    const id = String(row.info?.id || path.basename(path.dirname(file)) || "");
    if (id !== sessionId) continue;
    if (row.info?.cwd === target) {
      return { ok: true, reason: "unchanged" };
    }
    row.info = { ...(row.info || {}), cwd: target };
    await atomicWriteJson(file, row);
    return { ok: true, reason: "ok" };
  }
  return { ok: false, reason: "not-found" };
}

/** OpenCode stores cwd in opencode.db → session.directory. */
async function updateOpenCodeCwd(
  opencodeHome: string,
  sessionId: string,
  target: string
): Promise<NativeCwdUpdateResult> {
  const dbPath = path.join(opencodeHome, "opencode.db");
  try {
    await fs.access(dbPath);
  } catch {
    return { ok: false, reason: "not-found" };
  }
  const rows = await runSqliteJson<{ c: number }>(
    dbPath,
    `UPDATE session SET directory = '${escapeSqlLiteral(target)}'
     WHERE id = '${escapeSqlLiteral(sessionId)}';
     SELECT changes() AS c;`
  );
  if (!Number(rows[0]?.c)) {
    return { ok: false, reason: "not-found" };
  }
  return { ok: true, reason: "ok" };
}

/** Antigravity stores cwd in history.jsonl → workspace. */
async function updateAgyCwd(
  antigravityHome: string,
  sessionId: string,
  target: string
): Promise<NativeCwdUpdateResult> {
  for (const root of candidateAgyRoots(antigravityHome)) {
    const historyPath = path.join(root, "history.jsonl");
    let rows: Array<Record<string, any>>;
    try {
      rows = await readJsonLines(historyPath);
    } catch {
      continue;
    }
    if (!rows.some((row) => row.conversationId === sessionId)) {
      continue;
    }
    let changed = false;
    const next = rows.map((row) => {
      if (row.conversationId === sessionId && row.workspace !== target) {
        changed = true;
        return { ...row, workspace: target };
      }
      return row;
    });
    if (!changed) {
      return { ok: true, reason: "unchanged" };
    }
    await atomicWriteLines(historyPath, next);
    return { ok: true, reason: "ok" };
  }
  return { ok: false, reason: "not-found" };
}

/** Cursor CLI stores cwd in chats/<workspace>/<id>/meta.json. */
async function updateCursorCwd(
  cursorHome: string,
  sessionId: string,
  target: string
): Promise<NativeCwdUpdateResult> {
  const files = await findFilesByName(path.join(cursorHome, "chats"), "meta.json");
  for (const file of files) {
    let meta: Record<string, any>;
    try {
      meta = JSON.parse(await fs.readFile(file, "utf8"));
    } catch {
      continue;
    }
    const id = String(meta.id || path.basename(path.dirname(file)) || "");
    if (id !== sessionId) continue;
    if (meta.cwd === target) {
      return { ok: true, reason: "unchanged" };
    }
    meta.cwd = target;
    await atomicWriteJson(file, meta);
    return { ok: true, reason: "ok" };
  }
  return { ok: false, reason: "not-found" };
}

/**
 * Claude stores cwd in projects/**\/*.jsonl rows (first-row cwd wins on sync)
 * and a project label in the root history.jsonl.
 */
async function updateClaudeCwd(
  claudeHome: string,
  sessionId: string,
  target: string
): Promise<NativeCwdUpdateResult> {
  const files = await listJsonlFiles(path.join(claudeHome, "projects"));
  let touched = false;
  for (const file of files) {
    let rows: Array<Record<string, any>>;
    try {
      rows = await readJsonLines(file);
    } catch {
      continue;
    }
    if (!rows.some((row) => row.sessionId === sessionId && typeof row.cwd === "string")) {
      continue;
    }
    let changed = false;
    const next = rows.map((row) => {
      if (row.sessionId === sessionId && typeof row.cwd === "string" && row.cwd !== target) {
        changed = true;
        return { ...row, cwd: target };
      }
      return row;
    });
    if (changed) {
      await atomicWriteLines(file, next);
      touched = true;
    }
  }

  // Root history.jsonl mirrors the project label used by the sync reader.
  const historyPath = path.join(claudeHome, "history.jsonl");
  try {
    const rows = await readJsonLines<Record<string, any>>(historyPath);
    if (rows.some((row) => row.sessionId === sessionId && row.project !== target)) {
      const next = rows.map((row) =>
        row.sessionId === sessionId && typeof row.project === "string"
          ? { ...row, project: target }
          : row
      );
      await atomicWriteLines(historyPath, next);
      touched = true;
    }
  } catch {
    // history.jsonl is optional
  }

  return touched
    ? { ok: true, reason: "ok" }
    : { ok: false, reason: "not-found" };
}

/** Pi / Prime store cwd on the header row (type "session") of sessions/<id>.jsonl. */
async function updatePiPrimeCwd(
  home: string,
  sessionId: string,
  target: string
): Promise<NativeCwdUpdateResult> {
  const sessionsRoot = path.join(home, "sessions");
  let files: string[];
  try {
    files = await listJsonlFiles(sessionsRoot);
  } catch {
    return { ok: false, reason: "not-found" };
  }
  for (const file of files) {
    let rows: Array<Record<string, any>>;
    try {
      rows = await readJsonLines(file);
    } catch {
      continue;
    }
    const header = rows[0];
    if (!header || header.type !== "session" || String(header.id || "") !== sessionId) {
      continue;
    }
    if (header.cwd === target) {
      return { ok: true, reason: "unchanged" };
    }
    const next = rows.map((row, index) =>
      index === 0 ? { ...row, cwd: target } : row
    );
    await atomicWriteLines(file, next);
    return { ok: true, reason: "ok" };
  }
  return { ok: false, reason: "not-found" };
}

async function atomicWriteText(filePath: string, content: string): Promise<void> {
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tmp, content, "utf8");
  await fs.rename(tmp, filePath);
}

async function atomicWriteJson(filePath: string, value: unknown): Promise<void> {
  await atomicWriteText(filePath, `${JSON.stringify(value)}\n`);
}

async function atomicWriteLines(filePath: string, rows: Array<Record<string, any>>): Promise<void> {
  await atomicWriteText(filePath, rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : ""));
}
