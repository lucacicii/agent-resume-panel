import * as path from "node:path";
import { basenameOrPath } from "../history/pathUtils";

export function normalizeProjectPath(projectPath: string): string {
  return path.resolve(projectPath);
}

export function formatProjectLabel(projectPath: string, alias?: string): string {
  const base = basenameOrPath(projectPath);
  const trimmed = alias?.trim();
  return trimmed ? `${base} · ${trimmed}` : base;
}