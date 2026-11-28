import * as fs from "node:fs/promises";
import * as path from "node:path";
import { escapeSqlLiteral, runSqlite, runSqliteJson, runSqliteTransaction } from "../sqlite";
import type { SearchDocRowInput } from "./types";

const SEARCH_SCHEMA_VERSION = "1";
const SQLITE_BUSY_TIMEOUT_MS = 15_000;

type NodeDatabaseSyncType = {
  new (
    location: string,
    options?: { readOnly?: boolean; open?: boolean; enableForeignKeyConstraints?: boolean }
  ): {
    exec(sql: string): void;
    prepare(sql: string): {
      all(...params: unknown[]): unknown[];
      get(...params: unknown[]): unknown;
      run(...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
    };
    close(): void;
  };
};

let NodeDatabaseSync: NodeDatabaseSyncType | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodeSqlite = require("node:sqlite");
  if (typeof nodeSqlite?.DatabaseSync === "function") {
    NodeDatabaseSync = nodeSqlite.DatabaseSync;
  }
} catch {
  NodeDatabaseSync = null;
}

const ensuredIndexPaths = new Set<string>();
const indexWriteQueues = new Map<string, Promise<void>>();

export const SEARCH_INDEX_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS search_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS search_docs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_type TEXT NOT NULL,
  doc_key TEXT NOT NULL UNIQUE,
  provider TEXT NOT NULL DEFAULT '',
  acp_provider TEXT NOT NULL DEFAULT '',
  item_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  project_path TEXT NOT NULL DEFAULT '',
  project_id TEXT NOT NULL DEFAULT '',
  projects_text TEXT NOT NULL DEFAULT '',
  branch TEXT NOT NULL DEFAULT '',
  gtd_status TEXT NOT NULL DEFAULT '',
  scope TEXT NOT NULL DEFAULT '',
  rel_md_path TEXT NOT NULL DEFAULT '',
  filename TEXT NOT NULL DEFAULT '',
  linked_session_key TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  updated_at_ms INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  source_sig TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_search_docs_type_updated ON search_docs(doc_type, updated_at_ms DESC);
CREATE INDEX IF NOT EXISTS idx_search_docs_type_project ON search_docs(doc_type, project_path);
CREATE INDEX IF NOT EXISTS idx_search_docs_type_project_id ON search_docs(doc_type, project_id);
CREATE INDEX IF NOT EXISTS idx_search_docs_type_gtd ON search_docs(doc_type, gtd_status);

CREATE VIRTUAL TABLE IF NOT EXISTS search_docs_fts USING fts5(
  title,
  summary,
  project_path,
  branch,
  filename,
  body,
  content='search_docs',
  content_rowid='id',
  tokenize='trigram'
);

CREATE TRIGGER IF NOT EXISTS search_docs_ai AFTER INSERT ON search_docs BEGIN
  INSERT INTO search_docs_fts(rowid, title, summary, project_path, branch, filename, body)
  VALUES (new.id, new.title, new.summary, new.project_path, new.branch, new.filename, new.body);
END;

CREATE TRIGGER IF NOT EXISTS search_docs_ad AFTER DELETE ON search_docs BEGIN
  INSERT INTO search_docs_fts(search_docs_fts, rowid, title, summary, project_path, branch, filename, body)
  VALUES ('delete', old.id, old.title, old.summary, old.project_path, old.branch, old.filename, old.body);
END;

CREATE TRIGGER IF NOT EXISTS search_docs_au AFTER UPDATE ON search_docs BEGIN
  INSERT INTO search_docs_fts(search_docs_fts, rowid, title, summary, project_path, branch, filename, body)
  VALUES ('delete', old.id, old.title, old.summary, old.project_path, old.branch, old.filename, old.body);
  INSERT INTO search_docs_fts(rowid, title, summary, project_path, branch, filename, body)
  VALUES (new.id, new.title, new.summary, new.project_path, new.branch, new.filename, new.body);
END;
`;

export function hasInProcessSqlite(): boolean {
  return NodeDatabaseSync !== null;
}

export function resetSearchIndexSchemaCache(indexDbPath?: string): void {
  if (indexDbPath) {
    ensuredIndexPaths.delete(path.resolve(indexDbPath));
  } else {
    ensuredIndexPaths.clear();
  }
}

export async function ensureSearchIndexSchema(indexDbPath: string): Promise<void> {
  const resolved = path.resolve(indexDbPath);
  if (ensuredIndexPaths.has(resolved)) {
    return;
  }
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await runSearchWrite(resolved, async (db) => {
    if (db) {
      db.exec(SEARCH_INDEX_SCHEMA_SQL);
      db.prepare("INSERT OR REPLACE INTO search_meta(key, value) VALUES (?, ?)").run(
        "schema_version",
        SEARCH_SCHEMA_VERSION
      );
      return;
    }
    await runSqlite(
      resolved,
      `${SEARCH_INDEX_SCHEMA_SQL}\nINSERT OR REPLACE INTO search_meta(key, value) VALUES ('schema_version', '${SEARCH_SCHEMA_VERSION}');`
    );
  });
  ensuredIndexPaths.add(resolved);
}

export async function runSearchRead<T>(
  indexDbPath: string,
  operation: (db: InstanceType<NodeDatabaseSyncType> | null) => T | Promise<T>
): Promise<T> {
  const resolved = path.resolve(indexDbPath);
  if (NodeDatabaseSync) {
    let db: InstanceType<NodeDatabaseSyncType> | undefined;
    try {
      db = new NodeDatabaseSync(resolved, { readOnly: true });
      db.exec(`PRAGMA busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}; PRAGMA query_only = ON;`);
      return await operation(db);
    } finally {
      try {
        db?.close();
      } catch {
        // ignore close error
      }
    }
  }
  return operation(null);
}

export async function runSearchWrite<T>(
  indexDbPath: string,
  operation: (db: InstanceType<NodeDatabaseSyncType> | null) => T | Promise<T>
): Promise<T> {
  const resolved = path.resolve(indexDbPath);
  const previous = indexWriteQueues.get(resolved) || Promise.resolve();
  const task = previous.then(async () => {
    if (NodeDatabaseSync) {
      let db: InstanceType<NodeDatabaseSyncType> | undefined;
      try {
        db = new NodeDatabaseSync(resolved);
        db.exec(
          `PRAGMA busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}; PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA cache_size = -16000;`
        );
        return await operation(db);
      } finally {
        try {
          db?.close();
        } catch {
          // ignore close error
        }
      }
    }
    return operation(null);
  });
  indexWriteQueues.set(
    resolved,
    task.then(
      () => undefined,
      () => undefined
    )
  );
  return task;
}

export async function querySearchSql<T>(
  indexDbPath: string,
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  return runSearchRead(indexDbPath, async (db) => {
    if (db) {
      const rows = db.prepare(sql).all(...params);
      return rows.map((row) => Object.assign({}, row) as T);
    }
    const interpolated = interpolateSqlParams(sql, params);
    return runSqliteJson<T>(indexDbPath, interpolated);
  });
}

export async function upsertSearchDocsBatch(
  indexDbPath: string,
  docs: SearchDocRowInput[]
): Promise<void> {
  if (!docs.length) {
    return;
  }
  await runSearchWrite(indexDbPath, async (db) => {
    if (db) {
      const stmt = db.prepare(`
        INSERT INTO search_docs (
          doc_type, doc_key, provider, acp_provider, item_id, title, summary,
          project_path, project_id, projects_text, branch, gtd_status, scope,
          rel_md_path, filename, linked_session_key, body, updated_at_ms, archived, source_sig
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(doc_key) DO UPDATE SET
          doc_type = excluded.doc_type,
          provider = excluded.provider,
          acp_provider = excluded.acp_provider,
          item_id = excluded.item_id,
          title = excluded.title,
          summary = excluded.summary,
          project_path = excluded.project_path,
          project_id = excluded.project_id,
          projects_text = excluded.projects_text,
          branch = excluded.branch,
          gtd_status = excluded.gtd_status,
          scope = excluded.scope,
          rel_md_path = excluded.rel_md_path,
          filename = excluded.filename,
          linked_session_key = excluded.linked_session_key,
          body = excluded.body,
          updated_at_ms = excluded.updated_at_ms,
          archived = excluded.archived,
          source_sig = excluded.source_sig
      `);
      db.exec("BEGIN IMMEDIATE");
      try {
        for (const d of docs) {
          stmt.run(
            d.docType,
            d.docKey,
            d.provider,
            d.acpProvider,
            d.itemId,
            d.title,
            d.summary,
            d.projectPath,
            d.projectId,
            d.projectsText,
            d.branch,
            d.gtdStatus,
            d.scope,
            d.relMdPath,
            d.filename,
            d.linkedSessionKey,
            d.body,
            d.updatedAtMs,
            d.archived,
            d.sourceSig
          );
        }
        db.exec("COMMIT");
      } catch (err) {
        try {
          db.exec("ROLLBACK");
        } catch {
          // ignore rollback error
        }
        throw err;
      }
      return;
    }

    const CHUNK = 20;
    for (let i = 0; i < docs.length; i += CHUNK) {
      const slice = docs.slice(i, i + CHUNK);
      const statements = slice.map(
        (d) => `INSERT INTO search_docs (
          doc_type, doc_key, provider, acp_provider, item_id, title, summary,
          project_path, project_id, projects_text, branch, gtd_status, scope,
          rel_md_path, filename, linked_session_key, body, updated_at_ms, archived, source_sig
        ) VALUES (
          ${sqlText(d.docType)}, ${sqlText(d.docKey)}, ${sqlText(d.provider)}, ${sqlText(d.acpProvider)},
          ${sqlText(d.itemId)}, ${sqlText(d.title)}, ${sqlText(d.summary)},
          ${sqlText(d.projectPath)}, ${sqlText(d.projectId)}, ${sqlText(d.projectsText)},
          ${sqlText(d.branch)}, ${sqlText(d.gtdStatus)}, ${sqlText(d.scope)},
          ${sqlText(d.relMdPath)}, ${sqlText(d.filename)}, ${sqlText(d.linkedSessionKey)},
          ${sqlText(d.body)}, ${Math.floor(d.updatedAtMs)}, ${d.archived ? 1 : 0}, ${sqlText(d.sourceSig)}
        )
        ON CONFLICT(doc_key) DO UPDATE SET
          doc_type = excluded.doc_type,
          provider = excluded.provider,
          acp_provider = excluded.acp_provider,
          item_id = excluded.item_id,
          title = excluded.title,
          summary = excluded.summary,
          project_path = excluded.project_path,
          project_id = excluded.project_id,
          projects_text = excluded.projects_text,
          branch = excluded.branch,
          gtd_status = excluded.gtd_status,
          scope = excluded.scope,
          rel_md_path = excluded.rel_md_path,
          filename = excluded.filename,
          linked_session_key = excluded.linked_session_key,
          body = excluded.body,
          updated_at_ms = excluded.updated_at_ms,
          archived = excluded.archived,
          source_sig = excluded.source_sig`
      );
      await runSqliteTransaction(indexDbPath, statements);
    }
  });
}

export async function deleteSearchDocsByKeys(
  indexDbPath: string,
  docKeys: string[]
): Promise<void> {
  if (!docKeys.length) {
    return;
  }
  await runSearchWrite(indexDbPath, async (db) => {
    if (db) {
      const stmt = db.prepare("DELETE FROM search_docs WHERE doc_key = ?");
      db.exec("BEGIN IMMEDIATE");
      try {
        for (const key of docKeys) {
          stmt.run(key);
        }
        db.exec("COMMIT");
      } catch (err) {
        try {
          db.exec("ROLLBACK");
        } catch {
          // ignore
        }
        throw err;
      }
      return;
    }

    const CHUNK = 80;
    for (let i = 0; i < docKeys.length; i += CHUNK) {
      const list = docKeys
        .slice(i, i + CHUNK)
        .map(sqlText)
        .join(",");
      await runSqliteTransaction(indexDbPath, [
        `DELETE FROM search_docs WHERE doc_key IN (${list})`
      ]);
    }
  });
}

function sqlText(value: string): string {
  return `'${escapeSqlLiteral(value)}'`;
}

function interpolateSqlParams(sql: string, params: unknown[]): string {
  let index = 0;
  return sql.replace(/\?/g, () => {
    const val = params[index++];
    if (val == null) return "NULL";
    if (typeof val === "number") return Number.isFinite(val) ? String(val) : "0";
    if (typeof val === "boolean") return val ? "1" : "0";
    return `'${escapeSqlLiteral(String(val))}'`;
  });
}
