import { ensureCatalogSchema } from "../catalog/db";
import {
  deleteProjectNote,
  deleteSessionNote,
  getProjectNote,
  getSessionNote,
  loadProjectNoteFlags,
  loadSessionNoteFlags,
  upsertProjectNote,
  upsertSessionNote
} from "../catalog/notes";
import { AgentSession } from "../history/types";
import { sessionGtdKey } from "../catalog/gtd";
import { normalizeProjectPath } from "../projects/projectAliases";

export const MAX_NOTE_BYTES = 512 * 1024;

export class NotesStore {
  private sessionFlags = new Set<string>();
  private projectFlags = new Set<string>();

  constructor(private readonly dbPath: string) {}

  async initialize(): Promise<void> {
    await ensureCatalogSchema(this.dbPath);
    await this.reload();
  }

  async reload(): Promise<void> {
    this.sessionFlags = await loadSessionNoteFlags(this.dbPath);
    this.projectFlags = await loadProjectNoteFlags(this.dbPath);
  }

  hasSessionNote(session: Pick<AgentSession, "provider" | "id">): boolean {
    return this.sessionFlags.has(sessionGtdKey(session));
  }

  hasProjectNote(projectPath: string): boolean {
    return this.projectFlags.has(normalizeProjectPath(projectPath));
  }

  async getSessionNote(session: Pick<AgentSession, "provider" | "id">): Promise<string> {
    return (await getSessionNote(this.dbPath, session.provider, session.id)) ?? "";
  }

  async getProjectNote(projectPath: string): Promise<string> {
    return (await getProjectNote(this.dbPath, projectPath)) ?? "";
  }

  async setSessionNote(session: Pick<AgentSession, "provider" | "id">, content: string): Promise<void> {
    const trimmed = content.trim();
    if (!trimmed) {
      await deleteSessionNote(this.dbPath, session.provider, session.id);
      this.sessionFlags.delete(sessionGtdKey(session));
      return;
    }

    assertNoteSize(trimmed);
    await upsertSessionNote(this.dbPath, session.provider, session.id, trimmed);
    this.sessionFlags.add(sessionGtdKey(session));
  }

  async setProjectNote(projectPath: string, content: string): Promise<void> {
    const normalized = normalizeProjectPath(projectPath);
    const trimmed = content.trim();
    if (!trimmed) {
      await deleteProjectNote(this.dbPath, normalized);
      this.projectFlags.delete(normalized);
      return;
    }

    assertNoteSize(trimmed);
    await upsertProjectNote(this.dbPath, normalized, trimmed);
    this.projectFlags.add(normalized);
  }

  async deleteSessionNote(session: Pick<AgentSession, "provider" | "id">): Promise<void> {
    await deleteSessionNote(this.dbPath, session.provider, session.id);
    this.sessionFlags.delete(sessionGtdKey(session));
  }

  async deleteProjectNote(projectPath: string): Promise<void> {
    const normalized = normalizeProjectPath(projectPath);
    await deleteProjectNote(this.dbPath, normalized);
    this.projectFlags.delete(normalized);
  }
}

function assertNoteSize(content: string): void {
  if (Buffer.byteLength(content, "utf8") > MAX_NOTE_BYTES) {
    throw new Error(`Note exceeds maximum size of ${MAX_NOTE_BYTES} bytes.`);
  }
}