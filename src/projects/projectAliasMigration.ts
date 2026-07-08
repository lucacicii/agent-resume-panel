import * as vscode from "vscode";
import { ensureCatalogSchema } from "../catalog/db";
import { upsertProjectAliasesBatch } from "../catalog/projects";
import { normalizeProjectPath } from "./projectAliases";

export const LEGACY_PROJECT_ALIASES_STORAGE_KEY = "agentResume.projectAliases";
const MIGRATION_FLAG = "agentResume.projectAliasesMigratedToCatalog";

export async function migrateProjectAliasesToCatalog(
  context: vscode.ExtensionContext,
  dbPath: string
): Promise<void> {
  if (context.globalState.get<boolean>(MIGRATION_FLAG)) {
    return;
  }

  await ensureCatalogSchema(dbPath);

  const stored = context.globalState.get<Record<string, string>>(LEGACY_PROJECT_ALIASES_STORAGE_KEY, {});
  const entries = Object.entries(stored)
    .map(([projectPath, alias]) => ({
      projectPath: normalizeProjectPath(projectPath),
      alias: alias.trim()
    }))
    .filter((entry) => entry.alias.length > 0);

  if (entries.length > 0) {
    await upsertProjectAliasesBatch(dbPath, entries);
  }

  await context.globalState.update(LEGACY_PROJECT_ALIASES_STORAGE_KEY, undefined);
  await context.globalState.update(MIGRATION_FLAG, true);
}