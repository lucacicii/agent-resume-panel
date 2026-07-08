import * as vscode from "vscode";
import { NotesStore } from "./notesStore";
import { NOTE_SCHEME, parseNoteUri } from "./noteUri";

export class NoteFileSystemProvider implements vscode.FileSystemProvider {
  private readonly changeEmitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  readonly onDidChangeFile = this.changeEmitter.event;

  constructor(private readonly notesStore: NotesStore) {}

  watch(): vscode.Disposable {
    return new vscode.Disposable(() => undefined);
  }

  async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
    const target = parseNoteUri(uri);
    if (!target) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }

    const content = await this.readNoteContent(target);
    return {
      type: vscode.FileType.File,
      ctime: 0,
      mtime: Date.now(),
      size: Buffer.byteLength(content, "utf8")
    };
  }

  async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    const target = parseNoteUri(uri);
    if (!target) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }

    const content = await this.readNoteContent(target);
    return Buffer.from(content, "utf8");
  }

  async writeFile(
    uri: vscode.Uri,
    content: Uint8Array,
    options: { create: boolean; overwrite: boolean }
  ): Promise<void> {
    const target = parseNoteUri(uri);
    if (!target) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }

    const text = Buffer.from(content).toString("utf8");
    try {
      if (target.kind === "session") {
        await this.notesStore.setSessionNote(
          { provider: target.provider, id: target.sessionId },
          text
        );
      } else {
        await this.notesStore.setProjectNote(target.projectPath, text);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw vscode.FileSystemError.NoPermissions(message);
    }

    this.changeEmitter.fire([{ type: vscode.FileChangeType.Changed, uri }]);
    void options;
  }

  readDirectory(): Thenable<[string, vscode.FileType][]> {
    throw vscode.FileSystemError.FileNotFound(vscode.Uri.parse(`${NOTE_SCHEME}:/`));
  }

  createDirectory(): void {
    throw vscode.FileSystemError.NoPermissions("Cannot create directories in note storage.");
  }

  delete(): void {
    throw vscode.FileSystemError.NoPermissions("Use the delete note command instead.");
  }

  rename(): void {
    throw vscode.FileSystemError.NoPermissions("Notes cannot be renamed.");
  }

  private async readNoteContent(target: NonNullable<ReturnType<typeof parseNoteUri>>): Promise<string> {
    if (target.kind === "session") {
      return this.notesStore.getSessionNote({ provider: target.provider, id: target.sessionId });
    }
    return this.notesStore.getProjectNote(target.projectPath);
  }
}