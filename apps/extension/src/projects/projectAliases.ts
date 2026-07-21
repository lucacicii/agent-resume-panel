import * as path from "node:path";
import { toPortableKey } from "@agent-resume/core/extension";
import { basenameOrPath } from "../history/pathUtils";
import type { AgentSession } from "../history/types";

export function normalizeProjectPath(projectPath: string): string {
  return path.resolve(projectPath);
}

export function formatProjectLabel(projectPath: string, alias?: string): string {
  const base = basenameOrPath(projectPath);
  const trimmed = alias?.trim();
  return trimmed ? `${base} · ${trimmed}` : base;
}

/**
 * Group key for sidebar projects: prefer catalog project_id, else portable_key.
 * Aligns extension tree with Desktop logical projects.
 */
export function projectGroupKey(session: Pick<AgentSession, "projectPath" | "projectId">): string {
  const id = session.projectId?.trim();
  if (id) {
    return `id:${id}`;
  }
  const raw = session.projectPath?.trim() || process.env.HOME || "";
  return `key:${toPortableKey(raw)}`;
}

/** Prefer a stable display path for a group of sessions. */
export function pickProjectDisplayPath(sessions: AgentSession[]): string {
  if (!sessions.length) {
    return process.env.HOME || "";
  }
  // Prefer most recently updated session path
  const sorted = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt);
  return path.resolve(sorted[0].projectPath || process.env.HOME || "");
}