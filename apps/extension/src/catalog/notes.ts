export type { NoteRecord } from "@agent-resume/core/extension";
export {
  listAllNotes,
  getNoteById,
  getNoteByRelPath,
  listSessionNotes,
  listProjectNotes,
  upsertNoteRecord,
  deleteNoteRecord,
  deleteNotesByRelPaths,
  loadSessionNoteFlags,
  loadProjectNoteFlags,
  getCatalogMeta,
  setCatalogMeta,
  listLegacySessionNotes,
  listLegacyProjectNotes
} from "@agent-resume/core/extension";
