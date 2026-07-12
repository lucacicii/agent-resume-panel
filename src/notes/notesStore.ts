import * as vscode from "vscode";
import {
  NotesStore as CoreNotesStore,
  type ImportNotesResult,
  type NoteRecord
} from "@agent-resume/core";

export type { ImportNotesResult, NoteRecord };

export class NotesStore extends CoreNotesStore {
  async renameNote(noteId: string, desiredName: string): Promise<NoteRecord> {
    const record = await this.getNote(noteId);
    const oldAbs = record ? this.absolutePath(record) : "";
    const updated = await super.renameNote(noteId, desiredName);
    if (oldAbs) {
      await rebindNoteEditors(oldAbs, this.absolutePath(updated));
    }
    return updated;
  }

  async moveNote(
    noteId: string,
    owner: Parameters<CoreNotesStore["moveNote"]>[1]
  ): Promise<NoteRecord> {
    const record = await this.getNote(noteId);
    const oldAbs = record ? this.absolutePath(record) : "";
    const updated = await super.moveNote(noteId, owner);
    if (oldAbs) {
      await rebindNoteEditors(oldAbs, this.absolutePath(updated));
    }
    return updated;
  }
}

async function rebindNoteEditors(oldAbs: string, newAbs: string): Promise<void> {
  const openDocs = vscode.workspace.textDocuments.filter(
    (doc) => doc.uri.scheme === "file" && doc.uri.fsPath === oldAbs
  );
  if (!openDocs.length) {
    return;
  }

  for (const doc of openDocs) {
    if (doc.isDirty) {
      await doc.save();
    }
  }

  const newDoc = await vscode.workspace.openTextDocument(vscode.Uri.file(newAbs));
  for (const editor of vscode.window.visibleTextEditors) {
    if (editor.document.uri.fsPath === oldAbs) {
      await vscode.window.showTextDocument(newDoc, {
        viewColumn: editor.viewColumn,
        preview: false,
        preserveFocus: false
      });
    }
  }

  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      const input = tab.input as { uri?: vscode.Uri } | undefined;
      if (input?.uri?.fsPath === oldAbs) {
        await vscode.window.tabGroups.close(tab);
      }
    }
  }
}