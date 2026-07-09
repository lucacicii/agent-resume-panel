import * as path from "node:path";
import { expandHome } from "../pathUtils";

export const NOTES_ROOT_SEGMENT = "notes";

export function notesRoot(panelHome: string): string {
  return path.join(expandHome(panelHome), NOTES_ROOT_SEGMENT);
}

/** Match extension notesPaths.sessionDirKey */
export function sessionDirKey(sessionId: string): string {
  return Buffer.from(sessionId, "utf8").toString("base64url");
}

export function sessionNoteRelDir(provider: string, sessionId: string): string {
  return path.join("sessions", provider, sessionDirKey(sessionId));
}

export function sessionNoteAbsDir(panelHome: string, provider: string, sessionId: string): string {
  return path.join(notesRoot(panelHome), sessionNoteRelDir(provider, sessionId));
}

export function sessionTodolistRelMdPath(provider: string, sessionId: string): string {
  return path.join(NOTES_ROOT_SEGMENT, sessionNoteRelDir(provider, sessionId), "todolist.md");
}

export function sessionTodolistAbsPath(panelHome: string, provider: string, sessionId: string): string {
  return path.join(sessionNoteAbsDir(panelHome, provider, sessionId), "todolist.md");
}
