import { useEffect, useState } from "react";
import { desktopApi } from "../../bridge";
import { normalizeComposerMentions } from "../../workspacePacks";
import {
  DEFAULT_WORKBENCH_MENTION_SOURCES,
  normalizeWorkbenchMentionSources
} from "@agent-resume/core/browser";
import type {
  WorkbenchComposerMention,
  WorkbenchMentionSources
} from "@agent-resume/core";

/**
 * The entities an `@` can point at, shared by every composer that offers one.
 *
 * The chat composer injects a mention's content into the prompt; the terminal
 * and ACP composers have no prompt-compilation step, so they insert the
 * entity's path instead. Both read the same ordered, filtered list from here —
 * one rule for what `@` finds, whichever surface you type it on.
 */
export type ChatMentionSuggestion = {
  kind: "note" | "task" | "session" | "workspace";
  /** Mention key: note id, task id, session id, workspace-pack id. */
  id: string;
  title: string;
  subtitle?: string;
  badge: string;
  gtdStatus?: string;
  /** Absolute path a workspace mention binds or inserts. */
  path?: string;
};

export type MentionTask = {
  noteId: string;
  title?: string;
  gtdStatus?: string;
  updatedAtMs?: number;
  /** Note file behind the task, relative to the panel home. */
  relMdPath?: string;
  /** Absolute path to that file, as handed to a raw-text surface. */
  path?: string;
  work?: { projects?: string[]; primaryProject?: string };
};

export type MentionNote = { id: string; title: string; folder?: string; relMdPath?: string; path?: string };
export type MentionConversation = { id: string; title?: string; message_count?: number };

export const GTD_STATUS_LABELS: Record<string, string> = {
  inbox: "收集箱",
  next: "进行中",
  waiting: "等待中",
  someday: "将来",
  reference: "参考",
  done: "已完成"
};

/** TODO → DONE order, as the composer's `@` menu has always shown it. */
const GTD_STATUS_ORDER: Record<string, number> = {
  inbox: 0,
  todo: 0,
  next: 1,
  waiting: 2,
  done: 3
};

export function sortGtdTasks<T extends { gtdStatus?: string; updatedAtMs?: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const orderA = GTD_STATUS_ORDER[a.gtdStatus || "inbox"] ?? 99;
    const orderB = GTD_STATUS_ORDER[b.gtdStatus || "inbox"] ?? 99;
    if (orderA !== orderB) {
      return orderA - orderB;
    }
    return (b.updatedAtMs || 0) - (a.updatedAtMs || 0);
  });
}

export interface MentionSources {
  packs: WorkbenchComposerMention[];
  tasks: MentionTask[];
  notes: MentionNote[];
  conversations: MentionConversation[];
  /** Which kinds the composer should list. */
  enabled: WorkbenchMentionSources;
}

/**
 * Workspace packs, GTD tasks, notes and conversations, for a composer that
 * offers `@`. Each source degrades to empty on failure: a missing daemon or
 * catalog must not disable the composer. Catalog projects are deliberately not
 * loaded — a directory the user never named is not a mention, and the settings
 * pane is where such directories get promoted into packs.
 */
export function useMentionSources(): MentionSources {
  const [sources, setSources] = useState<MentionSources>({
    packs: [],
    tasks: [],
    notes: [],
    conversations: [],
    enabled: DEFAULT_WORKBENCH_MENTION_SOURCES
  });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const next: MentionSources = {
        packs: [],
        tasks: [],
        notes: [],
        conversations: [],
        enabled: DEFAULT_WORKBENCH_MENTION_SOURCES
      };
      try {
        const settings = await desktopApi().getSettings();
        next.packs = normalizeComposerMentions(settings?.workbench?.composerMentions);
        next.enabled = normalizeWorkbenchMentionSources(settings?.workbench?.composerMentionSources);
      } catch {
        // no packs configured
      }
      try {
        const tasks = await desktopApi().notesListTasks({ includeArchived: false });
        next.tasks = Array.isArray(tasks) ? tasks : [];
      } catch {
        // notes store unavailable
      }
      try {
        const notes = await desktopApi().notesList();
        next.notes = (Array.isArray(notes) ? notes : []).map((note) => ({
          id: note.noteId,
          title: note.title || note.noteId,
          folder: note.relDir,
          relMdPath: note.relMdPath
        }));
      } catch {
        // notes store unavailable
      }
      // A composer that types into a running agent cannot paste a note's body
      // safely, so it hands over the note's file instead. One batch call covers
      // both lists; a failure just leaves those entries without a path.
      try {
        const rels = [
          ...next.notes.map((note) => note.relMdPath ?? ""),
          ...next.tasks.map((task) => task.relMdPath ?? "")
        ].filter(Boolean);
        if (rels.length && typeof desktopApi().notesAbsolutePaths === "function") {
          const paths = await desktopApi().notesAbsolutePaths({ relMdPaths: rels });
          next.notes = next.notes.map((note) =>
            note.relMdPath && paths[note.relMdPath] ? { ...note, path: paths[note.relMdPath] } : note
          );
          next.tasks = next.tasks.map((task) =>
            task.relMdPath && paths[task.relMdPath]
              ? { ...task, path: paths[task.relMdPath] }
              : task
          );
        }
      } catch {
        // paths are a convenience; the mention still lists without one
      }
      try {
        const conversations = await desktopApi().thunderChatListConversations();
        next.conversations = Array.isArray(conversations)
          ? conversations.map((conversation) => ({
              id: conversation.id,
              title: conversation.title,
              message_count: conversation.message_count
            }))
          : [];
      } catch {
        // daemon offline
      }
      if (!cancelled) setSources(next);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return sources;
}

/**
 * `@` candidates for a query, in the order every composer shows them: the pack
 * that relocates the conversation first, then tasks, notes and conversations.
 * A kind switched off in Settings is never built, so a disabled source costs
 * nothing and leaves no stale row behind.
 */
export function buildMentionSuggestions(
  query: string,
  sources: MentionSources
): ChatMentionSuggestion[] {
  const q = query.toLowerCase();
  const out: ChatMentionSuggestion[] = [];

  const { enabled } = sources;
  for (const pack of enabled.workspaces ? sources.packs : []) {
    if (!q || pack.id.toLowerCase().includes(q) || pack.cwd.toLowerCase().includes(q)) {
      out.push({
        kind: "workspace",
        id: pack.id,
        title: pack.id,
        subtitle: pack.cwd,
        badge: "工作区",
        path: pack.cwd
      });
    }
  }
  for (const task of enabled.tasks ? sortGtdTasks(sources.tasks) : []) {
    const title = task.title || task.noteId;
    const statusLabel = GTD_STATUS_LABELS[task.gtdStatus || "inbox"] || "待办";
    if (!q || title.toLowerCase().includes(q) || statusLabel.toLowerCase().includes(q)) {
      out.push({
        kind: "task",
        id: task.noteId,
        title,
        subtitle: `[${statusLabel}]`,
        badge: "任务",
        gtdStatus: task.gtdStatus,
        path: task.path || task.work?.primaryProject || task.work?.projects?.[0]
      });
    }
  }
  for (const note of enabled.notes ? sources.notes : []) {
    if (!q || note.title.toLowerCase().includes(q) || note.folder?.toLowerCase().includes(q)) {
      out.push({
        kind: "note",
        id: note.id,
        title: note.title,
        subtitle: note.folder || "笔记",
        badge: "笔记",
        path: note.path
      });
    }
  }
  for (const conversation of enabled.sessions ? sources.conversations : []) {
    const title = conversation.title || "会话";
    if (!q || title.toLowerCase().includes(q)) {
      out.push({
        kind: "session",
        id: conversation.id,
        title,
        subtitle: `${conversation.message_count || 0} 条消息`,
        badge: "会话"
      });
    }
  }

  return out.slice(0, 30);
}
