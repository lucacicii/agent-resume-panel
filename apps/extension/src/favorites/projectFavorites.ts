import * as path from "node:path";
import * as vscode from "vscode";

const STORAGE_KEY = "agentResume.favoriteProjects";

export function normalizeProjectPath(projectPath: string): string {
  return path.resolve(projectPath);
}

export function loadFavoriteProjects(context: vscode.ExtensionContext): string[] {
  const stored = context.globalState.get<string[]>(STORAGE_KEY, []);
  const seen = new Set<string>();
  const output: string[] = [];

  for (const entry of stored) {
    const normalized = normalizeProjectPath(entry);
    if (seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    output.push(normalized);
  }

  return output;
}

export function isFavoriteProject(favorites: string[], projectPath: string): boolean {
  const normalized = normalizeProjectPath(projectPath);
  return favorites.some((favorite) => favorite === normalized);
}

export async function addFavoriteProject(
  context: vscode.ExtensionContext,
  projectPath: string
): Promise<string[]> {
  const normalized = normalizeProjectPath(projectPath);
  const favorites = loadFavoriteProjects(context);
  if (favorites.includes(normalized)) {
    return favorites;
  }

  const next = [...favorites, normalized];
  await context.globalState.update(STORAGE_KEY, next);
  return next;
}

export async function removeFavoriteProject(
  context: vscode.ExtensionContext,
  projectPath: string
): Promise<string[]> {
  const normalized = normalizeProjectPath(projectPath);
  const next = loadFavoriteProjects(context).filter((favorite) => favorite !== normalized);
  await context.globalState.update(STORAGE_KEY, next);
  return next;
}
