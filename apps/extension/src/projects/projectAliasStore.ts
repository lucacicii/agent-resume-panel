import * as vscode from "vscode";
import { reconcileProjectsFromSessions, toPortableKey } from "@agent-resume/core/extension";
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
    // Ensure sessions.project_id / portable merges exist even before first full sync.
    try {
      await reconcileProjectsFromSessions(this.dbPath);
    } catch (error) {
      console.warn("[agent-resume] project reconcile on activate failed:", error);
    }
    this.map = await loadProjectAliasesMap(this.dbPath);
  }

  get(projectPath: string): string | undefined {
    if (!projectPath?.trim()) {
      return undefined;
    }
    const normalized = normalizeProjectPath(projectPath);
    const portable = toPortableKey(normalized);
    return (
      this.map[normalized] ||
      this.map[projectPath] ||
      this.map[portable] ||
      undefined
    );
  }

  async set(projectPath: string, alias: string): Promise<void> {
    const normalized = normalizeProjectPath(projectPath);
    const portable = toPortableKey(normalized);
    const trimmed = alias.trim();

    await setProjectAliasInCatalog(this.dbPath, normalized, trimmed);

    // Refresh map so all path keys for the logical project stay in sync.
    this.map = await loadProjectAliasesMap(this.dbPath);

    if (!trimmed) {
      delete this.map[normalized];
      delete this.map[portable];
    }
  }

  async reload(): Promise<void> {
    await ensureCatalogSchema(this.dbPath);
    this.map = await loadProjectAliasesMap(this.dbPath);
  }
}
