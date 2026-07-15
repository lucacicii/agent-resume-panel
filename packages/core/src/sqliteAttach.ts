import { runSqliteJson } from "./sqlite";

function attachPathSql(filePath: string): string {
  return filePath.replace(/'/g, "''");
}

export async function queryNoteChunksWithProjects(
  desktopDb: string,
  catalogDb: string,
  sqlBody: string
): Promise<Record<string, unknown>[]> {
  const alias = "shared_catalog";
  const query = sqlBody.replaceAll("{catalog}", alias).replace(/;\s*$/, "");
  const script = [
    `ATTACH DATABASE '${attachPathSql(catalogDb)}' AS ${alias}`,
    query,
    `DETACH DATABASE ${alias}`
  ].join(";\n");
  return runSqliteJson(desktopDb, script);
}