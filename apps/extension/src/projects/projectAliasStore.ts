import * as vscode from "vscode";
import { ensureCatalogSchema } from "../catalog/db";
import { loadProjectAliasesMap, setProjectAliasInCatalog } from "../catalog/projects";
import { normalizeProjectPath } from "./projectAliases";
import { migrateProjectAliasesToCatalog } from "./projectAliasMigration";

export class ProjectAliasStore {
  private map: Record<string, string> = {};

  constructor(private readonly dbPath: string) {}

  async initialize(context: vscode.ExtensionContext): Promise<void> {
    await migrateProjectAliasesToCatalog(context, this.dbPath);
    await ensureCatalogSchema(this.dbPath);
    this.map = await loadProjectAliasesMap(this.dbPath);
  }

  get(projectPath: string): string | undefined {
    return this.map[normalizeProjectPath(projectPath)];
  }

  async set(projectPath: string, alias: string): Promise<void> {
    const normalized = normalizeProjectPath(projectPath);
    const trimmed = alias.trim();

    await setProjectAliasInCatalog(this.dbPath, normalized, trimmed);

    if (trimmed) {
      this.map[normalized] = trimmed;
    } else {
      delete this.map[normalized];
    }
  }
}