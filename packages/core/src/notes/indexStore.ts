import { createHash } from "node:crypto";
import { upsertNoteRecord } from "./catalogNotes";

export async function upsertSessionTodolistNoteIndex(
  dbPath: string,
  input: {
    provider: string;
    sessionId: string;
    projectPath: string;
    relDir: string;
    relMdPath: string;
    title: string;
    contentPreview: string;
    mtimeMs: number;
  }
): Promise<void> {
  // Stable note id from path so rewrites update same row
  const noteId = createHash("sha256").update(input.relMdPath).digest("hex").slice(0, 32);
  const now = Date.now();

  await upsertNoteRecord(dbPath, {
    noteId,
    scope: "session",
    provider: input.provider,
    agentSessionId: input.sessionId,
    projectPath: input.projectPath || undefined,
    filename: "todolist.md",
    relDir: input.relDir,
    relMdPath: input.relMdPath,
    title: input.title,
    contentPreview: input.contentPreview.slice(0, 240),
    createdAtMs: now,
    updatedAtMs: now,
    fsMtimeMs: input.mtimeMs
  });
}
