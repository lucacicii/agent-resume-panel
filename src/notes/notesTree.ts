import * as vscode from "vscode";
import { NoteRecord } from "../catalog/notes";
import { AgentSession } from "../history/types";
import { t } from "../i18n";
import { relativeTime } from "../util/relativeTime";
import { NotesStore } from "./notesStore";

export type NotesTreeNode =
  | { kind: "projectsRoot" }
  | { kind: "sessionsRoot" }
  | { kind: "project"; projectPath: string; notes: NoteRecord[] }
  | {
      kind: "session";
      provider: string;
      sessionId: string;
      projectPath?: string;
      title?: string;
      notes: NoteRecord[];
    }
  | { kind: "note"; note: NoteRecord }
  | { kind: "empty" }
  | { kind: "filterEmpty" };

export class NotesTreeProvider implements vscode.TreeDataProvider<NotesTreeNode> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<
    NotesTreeNode | undefined | null | void
  >();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  private filterText = "";
  private sessionsByKey = new Map<string, AgentSession>();
  private projectDisplayName: (projectPath: string) => string = (p) => p;

  constructor(private readonly notesStore: NotesStore) {}

  setProjectDisplayName(resolver: (projectPath: string) => string): void {
    this.projectDisplayName = resolver;
    this.refresh();
  }

  setSessions(sessions: AgentSession[]): void {
    this.sessionsByKey = new Map(
      sessions.map((s) => [`${s.provider}:${s.id}`, s] as const)
    );
    this.refresh();
  }

  getFilter(): string {
    return this.filterText;
  }

  setFilter(text: string): void {
    this.filterText = text.trim();
    this.refresh();
  }

  clearFilter(): void {
    this.filterText = "";
    this.refresh();
  }

  refresh(): void {
    this.onDidChangeTreeDataEmitter.fire();
  }

  getNoteFromNode(node: unknown): NoteRecord | undefined {
    if (node && typeof node === "object" && "kind" in node && (node as NotesTreeNode).kind === "note") {
      return (node as Extract<NotesTreeNode, { kind: "note" }>).note;
    }
    return undefined;
  }

  getTreeItem(element: NotesTreeNode): vscode.TreeItem {
    switch (element.kind) {
      case "projectsRoot": {
        const item = new vscode.TreeItem(t("tree.notes.projectsRoot"), vscode.TreeItemCollapsibleState.Expanded);
        item.iconPath = new vscode.ThemeIcon("folder-library");
        item.contextValue = "agentResume.notes.projectsRoot";
        item.id = "agentResume.notes.projectsRoot";
        return item;
      }
      case "sessionsRoot": {
        const item = new vscode.TreeItem(t("tree.notes.sessionsRoot"), vscode.TreeItemCollapsibleState.Expanded);
        item.iconPath = new vscode.ThemeIcon("comment-discussion");
        item.contextValue = "agentResume.notes.sessionsRoot";
        item.id = "agentResume.notes.sessionsRoot";
        return item;
      }
      case "project": {
        const item = new vscode.TreeItem(
          this.projectDisplayName(element.projectPath),
          vscode.TreeItemCollapsibleState.Collapsed
        );
        item.description = `${element.notes.length}`;
        item.iconPath = new vscode.ThemeIcon("folder");
        item.contextValue = "agentResume.notes.project";
        item.id = `agentResume.notes.project:${element.projectPath}`;
        item.tooltip = element.projectPath;
        return item;
      }
      case "session": {
        const session = this.sessionsByKey.get(`${element.provider}:${element.sessionId}`);
        const label = session?.title || element.title || element.sessionId;
        const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.Collapsed);
        const projectLabel = element.projectPath
          ? this.projectDisplayName(element.projectPath)
          : session?.projectPath
            ? this.projectDisplayName(session.projectPath)
            : undefined;
        item.description = [element.provider, projectLabel].filter(Boolean).join(" · ");
        item.iconPath = new vscode.ThemeIcon("comment");
        item.contextValue = "agentResume.notes.session";
        item.id = `agentResume.notes.session:${element.provider}:${element.sessionId}`;
        if (!session) {
          item.tooltip = t("tree.notes.orphanedSessionTooltip");
        }
        return item;
      }
      case "note": {
        const item = new vscode.TreeItem(element.note.filename, vscode.TreeItemCollapsibleState.None);
        item.description = relativeTime(element.note.updatedAtMs);
        item.iconPath = new vscode.ThemeIcon("markdown");
        item.contextValue = "agentResume.notes.note";
        item.id = `agentResume.notes.note:${element.note.noteId}`;
        item.command = {
          command: "agentResume.openNote",
          title: t("menu.notes.open"),
          arguments: [element]
        };
        item.tooltip = [
          element.note.title,
          element.note.relMdPath,
          element.note.contentPreview
        ]
          .filter(Boolean)
          .join("\n");
        return item;
      }
      case "empty": {
        const item = new vscode.TreeItem(t("tree.notes.empty"), vscode.TreeItemCollapsibleState.None);
        item.description = t("tree.notes.emptyDescription");
        item.iconPath = new vscode.ThemeIcon("info");
        return item;
      }
      case "filterEmpty": {
        const item = new vscode.TreeItem(t("tree.notes.filterEmpty"), vscode.TreeItemCollapsibleState.None);
        item.iconPath = new vscode.ThemeIcon("search");
        return item;
      }
    }
  }

  getChildren(element?: NotesTreeNode): NotesTreeNode[] {
    const notes = this.filteredNotes();

    if (!element) {
      if (!notes.length) {
        return [this.filterText ? { kind: "filterEmpty" } : { kind: "empty" }];
      }
      return [{ kind: "projectsRoot" }, { kind: "sessionsRoot" }];
    }

    if (element.kind === "projectsRoot") {
      const byProject = new Map<string, NoteRecord[]>();
      for (const note of notes) {
        if (note.scope !== "project" || !note.projectPath) {
          continue;
        }
        const list = byProject.get(note.projectPath) ?? [];
        list.push(note);
        byProject.set(note.projectPath, list);
      }
      return [...byProject.entries()]
        .map(([projectPath, projectNotes]) => ({
          kind: "project" as const,
          projectPath,
          notes: projectNotes.sort((a, b) => b.updatedAtMs - a.updatedAtMs)
        }))
        .sort((a, b) => {
          const aMax = a.notes[0]?.updatedAtMs ?? 0;
          const bMax = b.notes[0]?.updatedAtMs ?? 0;
          return bMax - aMax;
        });
    }

    if (element.kind === "sessionsRoot") {
      const bySession = new Map<string, NoteRecord[]>();
      for (const note of notes) {
        if (note.scope !== "session" || !note.provider || !note.agentSessionId) {
          continue;
        }
        const key = `${note.provider}:${note.agentSessionId}`;
        const list = bySession.get(key) ?? [];
        list.push(note);
        bySession.set(key, list);
      }
      return [...bySession.entries()]
        .map(([key, sessionNotes]) => {
          const [provider, sessionId] = splitSessionKey(key);
          const session = this.sessionsByKey.get(key);
          return {
            kind: "session" as const,
            provider,
            sessionId,
            projectPath: sessionNotes[0]?.projectPath ?? session?.projectPath,
            title: session?.title,
            notes: sessionNotes.sort((a, b) => b.updatedAtMs - a.updatedAtMs)
          };
        })
        .sort((a, b) => {
          const aMax = a.notes[0]?.updatedAtMs ?? 0;
          const bMax = b.notes[0]?.updatedAtMs ?? 0;
          return bMax - aMax;
        });
    }

    if (element.kind === "project" || element.kind === "session") {
      return element.notes.map((note) => ({ kind: "note" as const, note }));
    }

    return [];
  }

  private filteredNotes(): NoteRecord[] {
    const all = this.notesStore.getAllNotes();
    if (!this.filterText) {
      return all;
    }
    const q = this.filterText.toLowerCase();
    return all.filter((note) => {
      const session = note.provider && note.agentSessionId
        ? this.sessionsByKey.get(`${note.provider}:${note.agentSessionId}`)
        : undefined;
      const haystack = [
        note.filename,
        note.title,
        note.contentPreview,
        note.projectPath,
        note.projectPath ? this.projectDisplayName(note.projectPath) : undefined,
        note.provider,
        note.agentSessionId,
        session?.title
      ]
        .filter(Boolean)
        .join("\n")
        .toLowerCase();
      return haystack.includes(q);
    });
  }
}

function splitSessionKey(key: string): [string, string] {
  const idx = key.indexOf(":");
  if (idx < 0) {
    return [key, ""];
  }
  return [key.slice(0, idx), key.slice(idx + 1)];
}
