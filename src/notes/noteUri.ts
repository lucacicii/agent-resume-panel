import * as vscode from "vscode";
import { AgentSession } from "../history/types";
import { normalizeProjectPath } from "../projects/projectAliases";

export const NOTE_SCHEME = "agentresume-note";
export const NOTE_FILE_NAME = "note.md";

export type NoteTarget =
  | { kind: "session"; provider: AgentSession["provider"]; sessionId: string }
  | { kind: "project"; projectPath: string };

export function sessionNoteUri(provider: AgentSession["provider"], sessionId: string): vscode.Uri {
  return vscode.Uri.parse(
    `${NOTE_SCHEME}:/session/${encodeURIComponent(provider)}/${encodeURIComponent(sessionId)}/${NOTE_FILE_NAME}`
  );
}

export function projectNoteUri(projectPath: string): vscode.Uri {
  const encodedPath = encodeProjectPath(normalizeProjectPath(projectPath));
  return vscode.Uri.parse(`${NOTE_SCHEME}:/project/${encodedPath}/${NOTE_FILE_NAME}`);
}

export function parseNoteUri(uri: vscode.Uri): NoteTarget | undefined {
  if (uri.scheme !== NOTE_SCHEME) {
    return undefined;
  }

  const segments = uri.path.split("/").filter(Boolean);
  if (segments.length < 3 || segments[segments.length - 1] !== NOTE_FILE_NAME) {
    return undefined;
  }

  if (segments[0] === "session") {
    if (segments.length !== 4) {
      return undefined;
    }
    const provider = decodeURIComponent(segments[1]) as AgentSession["provider"];
    const sessionId = decodeURIComponent(segments[2]);
    return { kind: "session", provider, sessionId };
  }

  if (segments[0] === "project") {
    if (segments.length !== 3) {
      return undefined;
    }
    const projectPath = decodeProjectPath(segments[1]);
    if (!projectPath) {
      return undefined;
    }
    return { kind: "project", projectPath };
  }

  return undefined;
}

function encodeProjectPath(projectPath: string): string {
  return Buffer.from(projectPath, "utf8").toString("base64url");
}

function decodeProjectPath(encoded: string): string | undefined {
  try {
    return Buffer.from(encoded, "base64url").toString("utf8");
  } catch {
    return undefined;
  }
}