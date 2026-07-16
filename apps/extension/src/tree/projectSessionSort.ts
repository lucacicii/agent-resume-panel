import * as path from "node:path";
import * as vscode from "vscode";

export type ProjectSessionSortMode = "updatedDesc" | "updatedAsc" | "titleAsc" | "titleDesc";

const STORAGE_KEY = "agentResume.projectSessionSort";
const DEFAULT_MODE: ProjectSessionSortMode = "updatedDesc";

export function loadProjectSessionSortMap(context: vscode.ExtensionContext): Record<string, ProjectSessionSortMode> {
  return context.globalState.get<Record<string, ProjectSessionSortMode>>(STORAGE_KEY, {});
}

export async function setProjectSessionSortMode(
  context: vscode.ExtensionContext,
  projectPath: string,
  mode: ProjectSessionSortMode
): Promise<void> {
  const map = { ...loadProjectSessionSortMap(context) };
  map[normalizeProjectPath(projectPath)] = mode;
  await context.globalState.update(STORAGE_KEY, map);
}

export function getProjectSessionSortMode(
  context: vscode.ExtensionContext,
  projectPath: string
): ProjectSessionSortMode {
  const map = loadProjectSessionSortMap(context);
  return map[normalizeProjectPath(projectPath)] ?? DEFAULT_MODE;
}

export function sortSessionsForProject<T extends { title: string; updatedAt: number }>(
  sessions: T[],
  mode: ProjectSessionSortMode
): T[] {
  const copy = [...sessions];
  switch (mode) {
    case "updatedAsc":
      return copy.sort((a, b) => a.updatedAt - b.updatedAt);
    case "titleAsc":
      return copy.sort((a, b) => a.title.localeCompare(b.title) || b.updatedAt - a.updatedAt);
    case "titleDesc":
      return copy.sort((a, b) => b.title.localeCompare(a.title) || b.updatedAt - a.updatedAt);
    case "updatedDesc":
    default:
      return copy.sort((a, b) => b.updatedAt - a.updatedAt);
  }
}

function normalizeProjectPath(projectPath: string): string {
  return path.resolve(projectPath);
}

export function projectTreeItemId(projectPath: string): string {
  return `agentResume.project:${normalizeProjectPath(projectPath)}`;
}