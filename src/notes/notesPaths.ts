import { createHash } from "node:crypto";
import * as path from "node:path";
import { basenameOrPath, expandHome } from "../history/pathUtils";
import { normalizeProjectPath } from "../projects/projectAliases";
import { noteAssetsDirName } from "./noteNaming";
import { AgentSession } from "../history/types";

export const NOTES_ROOT_SEGMENT = "notes";

export type NoteScope = "session" | "project";

export interface ProjectNoteOwner {
  scope: "project";
  projectPath: string;
}

export interface SessionNoteOwner {
  scope: "session";
  provider: AgentSession["provider"];
  sessionId: string;
  projectPath?: string;
}

export type NoteOwner = ProjectNoteOwner | SessionNoteOwner;

export interface NoteOwnerJson {
  scope: NoteScope;
  projectPath?: string;
  provider?: string;
  sessionId?: string;
}

export function resolvePanelHome(panelHome?: string): string {
  return expandHome(panelHome?.trim() || "~/.agent-resume-panel");
}

export function notesRoot(panelHome: string): string {
  return path.join(resolvePanelHome(panelHome), NOTES_ROOT_SEGMENT);
}

export function projectDirKey(projectPath: string): string {
  const normalized = normalizeProjectPath(projectPath);
  const base =
    basenameOrPath(normalized)
      .replace(/[^a-zA-Z0-9._-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40) || "project";
  const hash = createHash("sha256").update(normalized).digest("hex").slice(0, 8);
  return `${base}__${hash}`;
}

export function sessionDirKey(sessionId: string): string {
  return Buffer.from(sessionId, "utf8").toString("base64url");
}

export function ownerRelDir(owner: NoteOwner): string {
  if (owner.scope === "project") {
    return path.join("projects", projectDirKey(owner.projectPath));
  }
  return path.join("sessions", owner.provider, sessionDirKey(owner.sessionId));
}

export function ownerAbsDir(panelHome: string, owner: NoteOwner): string {
  return path.join(notesRoot(panelHome), ownerRelDir(owner));
}

export function noteRelMdPath(owner: NoteOwner, filename: string): string {
  return path.join(NOTES_ROOT_SEGMENT, ownerRelDir(owner), filename);
}

export function noteAbsMdPath(panelHome: string, owner: NoteOwner, filename: string): string {
  return path.join(ownerAbsDir(panelHome, owner), filename);
}

export function noteAbsAssetsDir(panelHome: string, owner: NoteOwner, filename: string): string {
  return path.join(ownerAbsDir(panelHome, owner), noteAssetsDirName(filename));
}

export function absFromRelMdPath(panelHome: string, relMdPath: string): string {
  return path.join(resolvePanelHome(panelHome), relMdPath);
}

export function relMdPathFromAbs(panelHome: string, absPath: string): string | undefined {
  const root = resolvePanelHome(panelHome);
  const normalizedAbs = path.resolve(absPath);
  const normalizedRoot = path.resolve(root);
  if (normalizedAbs === normalizedRoot || !normalizedAbs.startsWith(normalizedRoot + path.sep)) {
    return undefined;
  }
  return path.relative(normalizedRoot, normalizedAbs);
}

export function isNotesMarkdownPath(panelHome: string, absPath: string): boolean {
  const rel = relMdPathFromAbs(panelHome, absPath);
  if (!rel || !rel.startsWith(`${NOTES_ROOT_SEGMENT}${path.sep}`) || !rel.endsWith(".md")) {
    return false;
  }
  if (rel.includes(`${path.sep}.assets${path.sep}`) || rel.includes(".assets" + path.sep)) {
    return false;
  }
  // skip files inside *.assets directories
  const parts = rel.split(path.sep);
  return !parts.some((p) => p.endsWith(".assets"));
}

export function ownerJsonPath(ownerDir: string): string {
  return path.join(ownerDir, ".owner.json");
}

export function serializeOwner(owner: NoteOwner): NoteOwnerJson {
  if (owner.scope === "project") {
    return { scope: "project", projectPath: normalizeProjectPath(owner.projectPath) };
  }
  return {
    scope: "session",
    provider: owner.provider,
    sessionId: owner.sessionId,
    projectPath: owner.projectPath ? normalizeProjectPath(owner.projectPath) : undefined
  };
}

export function parseOwnerJson(raw: unknown): NoteOwner | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const obj = raw as NoteOwnerJson;
  if (obj.scope === "project" && typeof obj.projectPath === "string" && obj.projectPath.trim()) {
    return { scope: "project", projectPath: normalizeProjectPath(obj.projectPath) };
  }
  if (
    obj.scope === "session" &&
    typeof obj.provider === "string" &&
    typeof obj.sessionId === "string" &&
    obj.sessionId.trim()
  ) {
    return {
      scope: "session",
      provider: obj.provider as AgentSession["provider"],
      sessionId: obj.sessionId,
      projectPath: obj.projectPath ? normalizeProjectPath(obj.projectPath) : undefined
    };
  }
  return undefined;
}
