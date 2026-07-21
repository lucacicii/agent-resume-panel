import * as path from "node:path";
import * as vscode from "vscode";
import { toPortableKey } from "@agent-resume/core/extension";

const STORAGE_KEY = "agentResume.favoriteProjects";

export function normalizeProjectPath(projectPath: string): string {
  return path.resolve(projectPath);
}

function favoriteKey(projectPath: string): string {
  try {
    return toPortableKey(normalizeProjectPath(projectPath));
  } catch {
    return normalizeProjectPath(projectPath);
  }
}

export function loadFavoriteProjects(context: vscode.ExtensionContext): string[] {
  const stored = context.globalState.get<string[]>(STORAGE_KEY, []);
  const seen = new Set<string>();
  const output: string[] = [];

  for (const entry of stored) {
    const normalized = normalizeProjectPath(entry);
    const key = favoriteKey(normalized);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(normalized);
  }

  return output;
}

export function isFavoriteProject(favorites: string[], projectPath: string): boolean {
  const key = favoriteKey(projectPath);
  const normalized = normalizeProjectPath(projectPath);
  return favorites.some(
    (favorite) => favorite === normalized || favoriteKey(favorite) === key
  );
}

export async function addFavoriteProject(
  context: vscode.ExtensionContext,
  projectPath: string
): Promise<string[]> {
  const normalized = normalizeProjectPath(projectPath);
  const favorites = loadFavoriteProjects(context);
  if (isFavoriteProject(favorites, normalized)) {
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
  const key = favoriteKey(projectPath);
  const next = loadFavoriteProjects(context).filter((favorite) => favoriteKey(favorite) !== key);
  await context.globalState.update(STORAGE_KEY, next);
  return next;
}
