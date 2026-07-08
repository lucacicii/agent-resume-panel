import { escapeSqlLiteral, runSqlite, runSqliteJson } from "../history/sqlite";
import { normalizeProjectPath } from "../projects/projectAliases";

interface ProjectAliasRow {
  project_path: string;
  alias: string;
}

export async function loadProjectAliasesMap(dbPath: string): Promise<Record<string, string>> {
  const rows = await runSqliteJson<ProjectAliasRow>(
    dbPath,
    "SELECT project_path, alias FROM projects ORDER BY project_path;"
  );

  const output: Record<string, string> = {};
  for (const row of rows) {
    const alias = row.alias.trim();
    if (!alias) {
      continue;
    }
    output[normalizeProjectPath(row.project_path)] = alias;
  }

  return output;
}

export async function getProjectAliasFromCatalog(
  dbPath: string,
  projectPath: string
): Promise<string | undefined> {
  const normalized = normalizeProjectPath(projectPath);
  const rows = await runSqliteJson<ProjectAliasRow>(
    dbPath,
    `SELECT project_path, alias FROM projects
     WHERE project_path = '${escapeSqlLiteral(normalized)}'
     LIMIT 1;`
  );

  const alias = rows[0]?.alias?.trim();
  return alias || undefined;
}

export async function setProjectAliasInCatalog(
  dbPath: string,
  projectPath: string,
  alias: string
): Promise<void> {
  const normalized = normalizeProjectPath(projectPath);
  const trimmed = alias.trim();

  if (!trimmed) {
    await runSqlite(
      dbPath,
      `DELETE FROM projects WHERE project_path = '${escapeSqlLiteral(normalized)}';`
    );
    return;
  }

  const nowMs = Date.now();
  await runSqlite(
    dbPath,
    `INSERT INTO projects (project_path, alias, updated_at_ms)
     VALUES ('${escapeSqlLiteral(normalized)}', '${escapeSqlLiteral(trimmed)}', ${nowMs})
     ON CONFLICT(project_path) DO UPDATE SET
       alias = excluded.alias,
       updated_at_ms = excluded.updated_at_ms;`
  );
}

export async function upsertProjectAliasesBatch(
  dbPath: string,
  entries: Array<{ projectPath: string; alias: string }>
): Promise<void> {
  if (!entries.length) {
    return;
  }

  const nowMs = Date.now();
  const statements = entries
    .map((entry) => {
      const normalized = normalizeProjectPath(entry.projectPath);
      const trimmed = entry.alias.trim();
      if (!trimmed) {
        return "";
      }

      return `INSERT INTO projects (project_path, alias, updated_at_ms)
        VALUES ('${escapeSqlLiteral(normalized)}', '${escapeSqlLiteral(trimmed)}', ${nowMs})
        ON CONFLICT(project_path) DO UPDATE SET
          alias = excluded.alias,
          updated_at_ms = excluded.updated_at_ms;`;
    })
    .filter(Boolean);

  if (!statements.length) {
    return;
  }

  await runSqlite(dbPath, `BEGIN;\n${statements.join("\n")}\nCOMMIT;`);
}