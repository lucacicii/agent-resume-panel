import React, { useRef, useState, useEffect, useMemo, useCallback } from "react";
import { ICON_SIZE, ThemeIcon } from "../../components/ThemeIcon";
import { NativeMenuSelect } from "../../components/NativeMenuSelect";
import { showContextMenuAt, type NativeContextMenuItem } from "../../nativeContextMenu";
import { desktopApi } from "../../bridge";
import type { AgentToolDescriptor, SkillDescriptor, ThunderModelInfo } from "@agent-resume/core";
import type { ChatRunMetrics } from "./useThunderChat";
import {
  atTokenAtCursor,
  hashTokenAtCursor,
  joinDirPath,
  slashTokenAtCursor
} from "./chatTokens";

export type ChatSlashSuggestion = {
  kind: "skill" | "mcp" | "command";
  name: string;
  description: string;
  location?: string;
};

export type ChatMentionSuggestion = {
  kind: "note" | "task" | "session";
  id: string;
  title: string;
  subtitle?: string;
  badge: string;
  gtdStatus?: string;
};

export type ChatPathSuggestion =
  | { kind: "directory"; name: string; relativePath: string }
  | { kind: "file"; name: string; relativePath: string }
  | { kind: "project"; label: string; path: string };

interface TaskSummary {
  noteId: string;
  title?: string;
  gtdStatus?: string;
  updatedAtMs?: number;
  work?: {
    projects?: string[];
    primaryProject?: string;
  };
}

const GTD_STATUS_ORDER: Record<string, number> = {
  inbox: 0,
  todo: 0,
  next: 1,
  waiting: 2,
  done: 3
};

const GTD_STATUS_LABELS: Record<string, string> = {
  inbox: "待办",
  next: "进行中",
  waiting: "等待",
  done: "已完成"
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

/**
 * Compile prompt by reading referenced skills, notes/tasks/sessions (@), and files (#)
 * into rich context blocks prepended to the user's prompt.
 */
export async function compileChatPrompt(
  rawText: string,
  options: {
    workspaceDir?: string;
    skills?: SkillDescriptor[];
    tools?: AgentToolDescriptor[];
    referencedMentions?: ChatMentionSuggestion[];
    referencedFiles?: string[];
  }
): Promise<string> {
  let userText = rawText.trim();
  if (!userText) return "";

  const contextBlocks: string[] = [];

  // 1. Resolve leading slash command: /skill-name or /tool-name
  const slashMatch = userText.match(/^\/([a-zA-Z0-9_-]+)(?:\s+(.*))?$/s);
  if (slashMatch) {
    const cmdName = slashMatch[1] ?? "";
    const rest = (slashMatch[2] || "").trim();

    const matchedSkill = options.skills?.find(
      (s) => s.name.toLowerCase() === cmdName.toLowerCase()
    );
    if (matchedSkill?.location && typeof desktopApi().readSkill === "function") {
      try {
        const content = await desktopApi().readSkill({ location: matchedSkill.location });
        if (content) {
          contextBlocks.push(
            `[Active Skill Instructions: ${matchedSkill.name}]\n${content.trim()}\n[End Skill Instructions]`
          );
          userText = rest || `Execute skill ${matchedSkill.name}`;
        }
      } catch (err) {
        console.warn("Failed to read skill instructions:", err);
      }
    } else {
      const matchedTool = options.tools?.find(
        (t) => t.name.toLowerCase() === cmdName.toLowerCase()
      );
      if (matchedTool) {
        contextBlocks.push(
          `[Requested MCP Tool: ${matchedTool.name}]\nDescription: ${matchedTool.description}\n[End Requested MCP Tool]`
        );
        userText = rest || `Use tool ${matchedTool.name}`;
      }
    }
  }

  // 2. Resolve @ mentions (Notes, Tasks, Sessions)
  const resolvedMentionIds = new Set<string>();
  if (options.referencedMentions && options.referencedMentions.length > 0) {
    for (const mention of options.referencedMentions) {
      if (resolvedMentionIds.has(mention.id)) continue;
      resolvedMentionIds.add(mention.id);

      try {
        if (mention.kind === "note" && typeof desktopApi().notesRead === "function") {
          const note = await desktopApi().notesRead({ noteId: mention.id });
          if (note?.content) {
            contextBlocks.push(
              `[Referenced Note: ${note.record?.title || mention.title}]\n${note.content.trim()}\n[End Referenced Note]`
            );
          }
        } else if (mention.kind === "task" && typeof desktopApi().notesRead === "function") {
          const taskDoc = await desktopApi().notesRead({ noteId: mention.id });
          const body = taskDoc?.content ? taskDoc.content.trim() : "";
          const status = mention.gtdStatus ? GTD_STATUS_LABELS[mention.gtdStatus] || mention.gtdStatus : "待办";
          contextBlocks.push(
            `[Referenced GTD Task: ${mention.title} (Status: ${status})]\n${body}\n[End Referenced Task]`
          );
        } else if (mention.kind === "session" && typeof desktopApi().thunderChatGetConversation === "function") {
          const conv = await desktopApi().thunderChatGetConversation({ sessionId: mention.id });
          if (conv && Array.isArray(conv.messages) && conv.messages.length > 0) {
            const recent = conv.messages.slice(-6).map((m: any) => {
              const content = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
              return `${m.role || "user"}: ${content}`;
            }).join("\n\n");
            contextBlocks.push(
              `[Referenced Conversation: ${conv.title || mention.title}]\n${recent}\n[End Referenced Conversation]`
            );
          }
        }
      } catch (err) {
        console.warn(`Failed to resolve mention ${mention.kind}:${mention.id}:`, err);
      }
    }
  }

  // 3. Resolve # files
  const filePathsToRead = new Set<string>(options.referencedFiles || []);
  const hashMatches = Array.from(userText.matchAll(/(?:^|\s)#([a-zA-Z0-9_\-./\\]+)/g));
  for (const m of hashMatches) {
    const rawPath = m[1];
    if (rawPath && !rawPath.endsWith("/")) {
      filePathsToRead.add(rawPath);
    }
  }

  if (filePathsToRead.size > 0 && options.workspaceDir && typeof desktopApi().workbenchReadFileText === "function") {
    for (const filePath of filePathsToRead) {
      try {
        const fileRes = await desktopApi().workbenchReadFileText({
          rootPath: options.workspaceDir,
          filePath,
          maxBytes: 64 * 1024
        });
        if (fileRes && typeof fileRes.content === "string") {
          contextBlocks.push(
            `[Referenced File: ${filePath}${fileRes.truncated ? " (truncated)" : ""}]\n${fileRes.content.trim()}\n[End Referenced File]`
          );
        }
      } catch {
        // File may be invalid, directory, or omitted; skip silently
      }
    }
  }

  if (contextBlocks.length === 0) {
    return userText;
  }

  return `${contextBlocks.join("\n\n")}\n\n${userText}`;
}

interface ChatComposerProps {
  onSend: (prompt: string, options?: { workspaceDir?: string; model?: string; thinking_level?: string }) => void;
  onCancel: () => void;
  isStreaming: boolean;
  models: ThunderModelInfo[];
  selectedModel: string;
  onSelectModel: (model: string) => void;
  thinkingLevel: string;
  onSelectThinkingLevel: (level: string) => void;
  workspaceDir: string;
  onSelectWorkspaceDir: (dir: string) => void;
  workspaceSource?: "finder" | "gtd";
  taskNoteId?: string | null;
  onSelectGtdTask?: (noteId: string, dir: string) => void;
  onSelectFinderDir?: (dir: string) => void;
  workspaceLocked?: boolean;
  useMock: boolean;
  onToggleMock: (mock: boolean) => void;
  placeholder?: string;
  prefillPrompt?: { text: string; id: number } | null;
  lastRunMetrics?: ChatRunMetrics | null;
  streamingMetrics?: { tokensCount: number; tps: number } | null;
  sessionTotalTokens?: number;
  currentContextTokens?: number;
  contextWindowLimit?: number;
}

function formatCompactTokens(num: number): string {
  if (num >= 1_000_000) {
    const val = num / 1_000_000;
    return `${val % 1 === 0 ? val.toFixed(0) : val.toFixed(1)}M`;
  }
  if (num >= 1_000) {
    const val = num / 1_000;
    return `${val % 1 === 0 ? val.toFixed(0) : val.toFixed(0)}k`;
  }
  return String(num);
}

function formatTokenCount(num: number): string {
  if (num >= 100_000) {
    return formatCompactTokens(num);
  }
  return num.toLocaleString();
}

export function ChatComposer({
  onSend,
  onCancel,
  isStreaming,
  models,
  selectedModel,
  onSelectModel,
  thinkingLevel,
  onSelectThinkingLevel,
  workspaceDir,
  onSelectWorkspaceDir,
  workspaceSource = "finder",
  taskNoteId,
  onSelectGtdTask,
  onSelectFinderDir,
  workspaceLocked = false,
  useMock,
  onToggleMock,
  placeholder = "Ask Thunder agent anything, or type / for skills/mcp, @ for context, # for files...",
  prefillPrompt,
  lastRunMetrics,
  streamingMetrics,
  sessionTotalTokens = 0,
  currentContextTokens = 0,
  contextWindowLimit
}: ChatComposerProps) {
  const [text, setText] = useState("");
  const [cursor, setCursor] = useState(0);
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [skills, setSkills] = useState<SkillDescriptor[]>([]);
  const [tools, setTools] = useState<AgentToolDescriptor[]>([]);
  const [notes, setNotes] = useState<Array<{ id: string; title: string; folder?: string }>>([]);
  const [conversations, setConversations] = useState<Array<{ id: string; title?: string; message_count?: number }>>([]);
  const [referencedMentions, setReferencedMentions] = useState<ChatMentionSuggestion[]>([]);
  const [referencedFiles, setReferencedFiles] = useState<string[]>([]);

  const [slashDismissed, setSlashDismissed] = useState(false);
  const [mentionDismissed, setMentionDismissed] = useState(false);
  const [directoryDismissed, setDirectoriesDismissed] = useState(false);

  const [activeSlash, setActiveSlash] = useState(0);
  const [activeMention, setActiveMention] = useState(0);
  const [activeDirectory, setActiveDirectory] = useState(0);

  const [directoryEntries, setDirectoryEntries] = useState<Array<{ name: string; isDirectory: boolean }> | null>(null);
  const [directoryLoading, setDirectoryLoading] = useState(false);
  const [directoryError, setDirectoryError] = useState("");

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const workspaceButtonRef = useRef<HTMLButtonElement | null>(null);
  const slashItemRefs = useRef<Array<HTMLLIElement | null>>([]);
  const mentionItemRefs = useRef<Array<HTMLLIElement | null>>([]);
  const directoryItemRefs = useRef<Array<HTMLLIElement | null>>([]);

  const loadTasks = useCallback(async () => {
    if (typeof desktopApi().notesListTasks !== "function") return;
    try {
      const records = await desktopApi().notesListTasks({ includeArchived: false });
      setTasks(records);
    } catch (err) {
      console.warn("Failed to load GTD tasks:", err);
    }
  }, []);

  useEffect(() => {
    void loadTasks();
    const handleMutated = () => {
      void loadTasks();
    };
    window.addEventListener("agent-resume:notes-mutated", handleMutated);
    return () => window.removeEventListener("agent-resume:notes-mutated", handleMutated);
  }, [loadTasks]);

  // Load skills & agent tools
  useEffect(() => {
    let cancelled = false;
    const loadSkillsAndTools = async () => {
      try {
        if (typeof desktopApi().listSkills === "function") {
          const s = await desktopApi().listSkills({ projectPath: workspaceDir });
          if (!cancelled && Array.isArray(s)) setSkills(s);
        }
        if (typeof desktopApi().listAgentTools === "function") {
          const t = await desktopApi().listAgentTools({ projectPath: workspaceDir });
          if (!cancelled && Array.isArray(t)) setTools(t);
        }
      } catch (err) {
        console.warn("Failed to load skills/tools:", err);
      }
    };
    void loadSkillsAndTools();
    return () => {
      cancelled = true;
    };
  }, [workspaceDir]);

  // Load notes & conversations for @ mentions
  useEffect(() => {
    let cancelled = false;
    const loadNotesAndConvs = async () => {
      try {
        if (typeof desktopApi().notesList === "function") {
          const n = await desktopApi().notesList();
          if (!cancelled && Array.isArray(n)) {
            setNotes(
              n.map((item) => ({
                id: item.noteId,
                title: item.title || item.noteId,
                folder: item.relDir
              }))
            );
          }
        }
        if (typeof desktopApi().thunderChatListConversations === "function") {
          const c = await desktopApi().thunderChatListConversations();
          if (!cancelled && Array.isArray(c)) setConversations(c);
        }
      } catch (err) {
        console.warn("Failed to load notes/conversations:", err);
      }
    };
    void loadNotesAndConvs();
    return () => {
      cancelled = true;
    };
  }, []);

  const currentTask = useMemo(() => {
    if (workspaceSource === "gtd" && taskNoteId) {
      return tasks.find((t) => t.noteId === taskNoteId) || null;
    }
    return null;
  }, [tasks, workspaceSource, taskNoteId]);

  // Handle prefill injection from edit prompt actions
  useEffect(() => {
    if (prefillPrompt && prefillPrompt.text) {
      setText(prefillPrompt.text);
      setTimeout(() => {
        const el = textareaRef.current;
        if (el) {
          el.focus();
          el.setSelectionRange(el.value.length, el.value.length);
          setCursor(el.value.length);
        }
      }, 50);
    }
  }, [prefillPrompt]);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const nextHeight = Math.min(Math.max(el.scrollHeight, 44), 220);
    el.style.height = `${nextHeight}px`;
  }, [text]);

  // Auto-load saved workspace if none selected
  useEffect(() => {
    if (!workspaceDir) {
      const saved =
        localStorage.getItem("chat-selected-workspace") ||
        localStorage.getItem("workbench-selected-project") ||
        "";
      if (saved) {
        onSelectWorkspaceDir(saved);
      }
    }
  }, [workspaceDir, onSelectWorkspaceDir]);

  // Cursor tokens
  const slashToken = useMemo(() => slashTokenAtCursor(text, cursor), [cursor, text]);
  const atToken = useMemo(() => atTokenAtCursor(text, cursor), [cursor, text]);
  const hashToken = useMemo(() => hashTokenAtCursor(text, cursor), [cursor, text]);

  // Slash suggestions (/): skills + mcp tools
  const slashSuggestions = useMemo<ChatSlashSuggestion[]>(() => {
    if (!slashToken) return [];
    const q = slashToken.query.toLowerCase();
    const out: ChatSlashSuggestion[] = [];

    for (const s of skills) {
      if (!q || s.name.toLowerCase().includes(q) || s.description?.toLowerCase().includes(q)) {
        out.push({
          kind: "skill",
          name: s.name,
          description: s.description || "Skill",
          location: s.location
        });
      }
    }

    for (const t of tools) {
      if (t.kind === "skill") continue;
      if (!q || t.name.toLowerCase().includes(q) || t.description?.toLowerCase().includes(q)) {
        out.push({
          kind: "mcp",
          name: t.name,
          description: t.description || "MCP Tool"
        });
      }
    }

    return out.slice(0, 30);
  }, [slashToken, skills, tools]);

  // Mention suggestions (@): notes, GTD tasks, sessions
  const mentionSuggestions = useMemo<ChatMentionSuggestion[]>(() => {
    if (!atToken) return [];
    const q = atToken.query.toLowerCase();
    const out: ChatMentionSuggestion[] = [];

    // GTD Tasks first
    for (const t of sortGtdTasks(tasks)) {
      const title = t.title || t.noteId;
      const statusLabel = GTD_STATUS_LABELS[t.gtdStatus || "inbox"] || "待办";
      if (!q || title.toLowerCase().includes(q) || statusLabel.toLowerCase().includes(q)) {
        out.push({
          kind: "task",
          id: t.noteId,
          title,
          subtitle: `[${statusLabel}]`,
          badge: "任务",
          gtdStatus: t.gtdStatus
        });
      }
    }

    // Notes
    for (const n of notes) {
      if (!q || n.title.toLowerCase().includes(q) || n.folder?.toLowerCase().includes(q)) {
        out.push({
          kind: "note",
          id: n.id,
          title: n.title,
          subtitle: n.folder || "笔记",
          badge: "笔记"
        });
      }
    }

    // Sessions
    for (const c of conversations) {
      const title = c.title || "会话";
      if (!q || title.toLowerCase().includes(q)) {
        out.push({
          kind: "session",
          id: c.id,
          title,
          subtitle: `${c.message_count || 0} 条消息`,
          badge: "会话"
        });
      }
    }

    return out.slice(0, 30);
  }, [atToken, tasks, notes, conversations]);

  // Path suggestions (#): directories and files
  const directoryQueryPath = hashToken?.dirPath ?? "";
  const workspaceProjects = currentTask?.work?.projects || [];
  const sharedWorkspaceRoot = directoryQueryPath === "" && workspaceProjects.length > 0;

  const directoryProject = useMemo(() => {
    if (!directoryQueryPath) return undefined;
    const first = directoryQueryPath.split("/")[0];
    return workspaceProjects.find((p) => p.split("/").pop() === first || p === first);
  }, [directoryQueryPath, workspaceProjects]);

  const directoryListRoot = directoryProject ? directoryProject : workspaceDir;

  const currentDirectory = useMemo(() => {
    if (!hashToken) return null;
    if (!directoryQueryPath) return workspaceDir;
    const rest = directoryProject
      ? directoryQueryPath.split("/").slice(1).join("/")
      : directoryQueryPath;
    return rest ? joinDirPath(directoryListRoot, rest) : directoryListRoot;
  }, [directoryListRoot, directoryProject, directoryQueryPath, hashToken, workspaceDir]);

  useEffect(() => {
    setActiveDirectory(0);
    if (sharedWorkspaceRoot) {
      setDirectoryEntries(null);
      setDirectoryError("");
      setDirectoryLoading(false);
      return;
    }
    if (!hashToken || !currentDirectory || typeof desktopApi().workbenchListDirectory !== "function") {
      return;
    }
    let cancelled = false;
    setDirectoryEntries(null);
    setDirectoryError("");
    setDirectoryLoading(true);

    void desktopApi().workbenchListDirectory({ rootPath: directoryListRoot, dirPath: currentDirectory })
      .then((res) => {
        if (cancelled) return;
        setDirectoryEntries(res.entries || []);
      })
      .catch((err: unknown) => {
        if (!cancelled) setDirectoryError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setDirectoryLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [currentDirectory, directoryListRoot, hashToken, sharedWorkspaceRoot]);

  const directorySuggestions = useMemo<ChatPathSuggestion[]>(() => {
    if (!hashToken) return [];
    const q = hashToken.query.toLowerCase();

    if (sharedWorkspaceRoot) {
      return workspaceProjects
        .map((projPath) => {
          const label = projPath.split("/").filter(Boolean).pop() || projPath;
          return { kind: "project" as const, label, path: projPath };
        })
        .filter((p) => !q || p.label.toLowerCase().includes(q) || p.path.toLowerCase().includes(q));
    }

    if (!directoryEntries) return [];

    return directoryEntries
      .filter((entry) => !q || entry.name.toLowerCase().includes(q))
      .sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) {
          return a.isDirectory ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      })
      .map((entry) => {
        const rel = directoryQueryPath ? `${directoryQueryPath}/${entry.name}` : entry.name;
        return entry.isDirectory
          ? { kind: "directory" as const, name: entry.name, relativePath: rel }
          : { kind: "file" as const, name: entry.name, relativePath: rel };
      });
  }, [directoryEntries, directoryQueryPath, hashToken, sharedWorkspaceRoot, workspaceProjects]);

  const slashOpen = Boolean(slashToken) && !slashDismissed && slashSuggestions.length > 0;
  const mentionOpen = !slashOpen && Boolean(atToken) && !mentionDismissed && mentionSuggestions.length > 0;
  const directoryOpen = !slashOpen && !mentionOpen && Boolean(hashToken) && !directoryDismissed;

  // Auto-scroll active option into view
  useEffect(() => {
    if (!slashOpen || !slashSuggestions.length) return;
    const frame = requestAnimationFrame(() => {
      const el = slashItemRefs.current[activeSlash];
      if (typeof el?.scrollIntoView === "function") {
        el.scrollIntoView({ block: "nearest" });
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [activeSlash, slashOpen, slashSuggestions]);

  useEffect(() => {
    if (!mentionOpen || !mentionSuggestions.length) return;
    const frame = requestAnimationFrame(() => {
      const el = mentionItemRefs.current[activeMention];
      if (typeof el?.scrollIntoView === "function") {
        el.scrollIntoView({ block: "nearest" });
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [activeMention, mentionOpen, mentionSuggestions]);

  useEffect(() => {
    if (!directoryOpen || !directorySuggestions.length) return;
    const frame = requestAnimationFrame(() => {
      const el = directoryItemRefs.current[activeDirectory];
      if (typeof el?.scrollIntoView === "function") {
        el.scrollIntoView({ block: "nearest" });
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [activeDirectory, directoryOpen, directorySuggestions]);

  const acceptSlashSuggestion = useCallback(
    (item: ChatSlashSuggestion) => {
      if (!slashToken) return;
      const inserted = `/${item.name} `;
      const next = `${text.slice(0, slashToken.start)}${inserted}${text.slice(cursor)}`;
      const nextCursor = slashToken.start + inserted.length;
      setText(next);
      setSlashDismissed(true);
      setActiveSlash(0);
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (el) {
          el.focus();
          el.setSelectionRange(nextCursor, nextCursor);
        }
        setCursor(nextCursor);
      });
    },
    [cursor, slashToken, text]
  );

  const acceptMentionSuggestion = useCallback(
    (item: ChatMentionSuggestion) => {
      if (!atToken) return;
      const inserted = `@${item.title} `;
      const next = `${text.slice(0, atToken.start)}${inserted}${text.slice(cursor)}`;
      const nextCursor = atToken.start + inserted.length;
      setText(next);
      setMentionDismissed(true);
      setActiveMention(0);
      setReferencedMentions((prev) => [...prev, item]);
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (el) {
          el.focus();
          el.setSelectionRange(nextCursor, nextCursor);
        }
        setCursor(nextCursor);
      });
    },
    [atToken, cursor, text]
  );

  const enterDirectory = useCallback(
    (suggestion: ChatPathSuggestion) => {
      if (!hashToken) return;
      const inserted =
        suggestion.kind === "project"
          ? `#${suggestion.label}/`
          : `#${directoryQueryPath ? `${directoryQueryPath}/${suggestion.name}` : suggestion.name}/`;
      const next = `${text.slice(0, hashToken.start)}${inserted}${text.slice(cursor)}`;
      const nextCursor = hashToken.start + inserted.length;
      setText(next);
      setActiveDirectory(0);
      setDirectoriesDismissed(false);
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (el) {
          el.focus();
          el.setSelectionRange(nextCursor, nextCursor);
        }
        setCursor(nextCursor);
      });
    },
    [cursor, directoryQueryPath, hashToken, text]
  );

  const leaveDirectory = useCallback(() => {
    if (!hashToken || !directoryQueryPath) return;
    const parent = directoryQueryPath.split("/").filter(Boolean).slice(0, -1).join("/");
    const inserted = parent ? `#${parent}/` : "#";
    const next = `${text.slice(0, hashToken.start)}${inserted}${text.slice(cursor)}`;
    const nextCursor = hashToken.start + inserted.length;
    setText(next);
    setActiveDirectory(0);
    setDirectoriesDismissed(false);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(nextCursor, nextCursor);
      }
      setCursor(nextCursor);
    });
  }, [cursor, directoryQueryPath, hashToken, text]);

  const acceptDirectory = useCallback(
    (suggestion: ChatPathSuggestion) => {
      if (!hashToken) return;
      if (suggestion.kind === "directory" || suggestion.kind === "project") {
        enterDirectory(suggestion);
        return;
      }
      const inserted = `#${suggestion.relativePath} `;
      const next = `${text.slice(0, hashToken.start)}${inserted}${text.slice(cursor)}`;
      const nextCursor = hashToken.start + inserted.length;
      setText(next);
      setDirectoriesDismissed(true);
      setActiveDirectory(0);
      setReferencedFiles((prev) => [...new Set([...prev, suggestion.relativePath])]);
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (el) {
          el.focus();
          el.setSelectionRange(nextCursor, nextCursor);
        }
        setCursor(nextCursor);
      });
    },
    [enterDirectory, hashToken, cursor, text]
  );

  const doSend = async () => {
    if (isStreaming) {
      onCancel();
      return;
    }
    const currentText = text.trim();
    if (!currentText) return;

    setText("");
    const mentionsToCompile = [...referencedMentions];
    const filesToCompile = [...referencedFiles];
    setReferencedMentions([]);
    setReferencedFiles([]);

    try {
      const effectivePrompt = await compileChatPrompt(currentText, {
        workspaceDir,
        skills,
        tools,
        referencedMentions: mentionsToCompile,
        referencedFiles: filesToCompile
      });
      onSend(effectivePrompt, { workspaceDir, model: selectedModel, thinking_level: thinkingLevel });
    } catch (err) {
      console.warn("Failed to compile prompt context:", err);
      onSend(currentText, { workspaceDir, model: selectedModel, thinking_level: thinkingLevel });
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (slashOpen && slashSuggestions.length > 0) {
      if (e.key === "Escape") {
        e.preventDefault();
        setSlashDismissed(true);
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveSlash((prev) => (prev + 1) % slashSuggestions.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveSlash((prev) => (prev - 1 + slashSuggestions.length) % slashSuggestions.length);
        return;
      }
      if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
        e.preventDefault();
        const pick = slashSuggestions[activeSlash] ?? slashSuggestions[0];
        if (pick) acceptSlashSuggestion(pick);
        return;
      }
    }

    if (mentionOpen && mentionSuggestions.length > 0) {
      if (e.key === "Escape") {
        e.preventDefault();
        setMentionDismissed(true);
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveMention((prev) => (prev + 1) % mentionSuggestions.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveMention((prev) => (prev - 1 + mentionSuggestions.length) % mentionSuggestions.length);
        return;
      }
      if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
        e.preventDefault();
        const pick = mentionSuggestions[activeMention] ?? mentionSuggestions[0];
        if (pick) acceptMentionSuggestion(pick);
        return;
      }
    }

    if (directoryOpen) {
      if (e.key === "Escape") {
        e.preventDefault();
        setDirectoriesDismissed(true);
        return;
      }
      if (e.key === "ArrowLeft" && directoryQueryPath) {
        e.preventDefault();
        leaveDirectory();
        return;
      }
      if (directorySuggestions.length > 0) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setActiveDirectory((prev) => (prev + 1) % directorySuggestions.length);
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setActiveDirectory((prev) => (prev - 1 + directorySuggestions.length) % directorySuggestions.length);
          return;
        }
        if (e.key === "ArrowRight") {
          e.preventDefault();
          const pick = directorySuggestions[activeDirectory];
          if (pick) enterDirectory(pick);
          return;
        }
        if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
          e.preventDefault();
          const pick = directorySuggestions[activeDirectory];
          if (pick) acceptDirectory(pick);
          return;
        }
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (isStreaming) {
        return;
      }
      if (text.trim()) {
        void doSend();
      }
    }
  };

  const handleSendClick = () => {
    if (isStreaming) {
      onCancel();
    } else if (text.trim()) {
      void doSend();
    }
  };

  const handleOpenWorkspaceMenu = async () => {
    if (workspaceLocked) return;

    let currentTasks = tasks;
    if (typeof desktopApi().notesListTasks === "function") {
      try {
        currentTasks = await desktopApi().notesListTasks({ includeArchived: false });
        setTasks(currentTasks);
      } catch {
        // fallback to existing
      }
    }

    const rect = workspaceButtonRef.current?.getBoundingClientRect();
    if (!rect) return;

    const sortedTasks = sortGtdTasks(currentTasks);

    const items: NativeContextMenuItem[] = [
      {
        id: "finder:choose",
        label: "📁 从 Finder 指定本地目录...",
        type: "normal"
      },
      { type: "separator" },
      {
        label: "── GTD 任务 (按 TODO → DONE 排序) ──",
        enabled: false
      }
    ];

    if (sortedTasks.length === 0) {
      items.push({
        label: "(暂无 GTD 任务)",
        enabled: false
      });
    } else {
      for (const task of sortedTasks) {
        const statusLabel = GTD_STATUS_LABELS[task.gtdStatus || "inbox"] || "待办";
        const isChecked = workspaceSource === "gtd" && taskNoteId === task.noteId;
        items.push({
          id: `gtd:${task.noteId}`,
          label: `[${statusLabel}] ${task.title || task.noteId}`,
          type: "checkbox",
          checked: isChecked
        });
      }
    }

    const chosen = await showContextMenuAt({ x: rect.left, y: rect.bottom + 4 }, items);
    if (!chosen) return;

    if (chosen === "finder:choose") {
      try {
        const picked = await desktopApi().pickDirectory();
        if (picked && picked.ok) {
          if (onSelectFinderDir) {
            onSelectFinderDir(picked.path);
          } else {
            localStorage.setItem("chat-selected-workspace", picked.path);
            onSelectWorkspaceDir(picked.path);
          }
        }
      } catch (err) {
        console.warn("Failed to pick directory:", err);
      }
    } else if (chosen.startsWith("gtd:")) {
      const selectedId = chosen.slice(4);
      try {
        let dir = "";
        if (typeof desktopApi().notesEnsureTaskWorkspace === "function") {
          const res = await desktopApi().notesEnsureTaskWorkspace({ noteId: selectedId });
          dir = res?.dir || "";
        }
        if (onSelectGtdTask) {
          onSelectGtdTask(selectedId, dir);
        } else {
          onSelectWorkspaceDir(dir);
        }
      } catch (err) {
        console.warn("Failed to ensure task workspace:", err);
      }
    }
  };

  const workspaceLabel = useMemo(() => {
    if (workspaceSource === "gtd") {
      if (currentTask) {
        const statusLabel = GTD_STATUS_LABELS[currentTask.gtdStatus || "inbox"] || "待办";
        return `[${statusLabel}] ${currentTask.title || currentTask.noteId}`;
      }
      return "[GTD 任务]";
    }
    return workspaceDir
      ? workspaceDir.split("/").filter(Boolean).pop() || workspaceDir
      : "选择工作区";
  }, [workspaceSource, currentTask, workspaceDir]);

  const workspaceTitle = useMemo(() => {
    if (workspaceLocked) {
      return `${workspaceDir} (工作区已与该对话锁定)`;
    }
    if (workspaceSource === "gtd") {
      const title = currentTask?.title || taskNoteId || "GTD 任务";
      const status = GTD_STATUS_LABELS[currentTask?.gtdStatus || "inbox"] || "待办";
      const repos = currentTask?.work?.projects?.length
        ? `\n共享目录: ${currentTask.work.projects.join(", ")}`
        : "";
      return `GTD 任务: ${title} (${status})\n工作区路径: ${workspaceDir}${repos}\n(点击切换 GTD 任务或从 Finder 选择)`;
    }
    return workspaceDir
      ? `Finder 目录: ${workspaceDir}\n(点击切换 GTD 任务或从 Finder 选择)`
      : "点击选择 GTD 任务或从 Finder 指定目录";
  }, [workspaceLocked, workspaceSource, currentTask, taskNoteId, workspaceDir]);

  const modelOptions = useMemo(() => {
    if (models.length === 0) {
      return [{ value: "mock", label: "Mock Agent Mode" }];
    }
    return models.map((m) => ({
      value: m.selection_id || m.id,
      label: m.name || m.selection_id || m.id
    }));
  }, [models]);

  const currentModel = useMemo(() => {
    return models.find((m) => (m.selection_id || m.id) === selectedModel);
  }, [models, selectedModel]);

  const thinkingOptions = useMemo(() => {
    const levels = currentModel?.thinking_levels;
    if (Array.isArray(levels) && levels.length > 0) {
      return levels.map((lvl) => {
        const capitalized = lvl.charAt(0).toUpperCase() + lvl.slice(1);
        return {
          value: lvl,
          label: `Thinking: ${capitalized}`
        };
      });
    }

    if (currentModel?.reasoning) {
      return [
        { value: "off", label: "Thinking: Off" },
        { value: "low", label: "Thinking: Low" },
        { value: "medium", label: "Thinking: Medium" },
        { value: "high", label: "Thinking: High" }
      ];
    }

    return [{ value: "off", label: "Thinking: Off" }];
  }, [currentModel]);

  const supportsThinking = useMemo(() => {
    if (!currentModel) return false;
    if (currentModel.reasoning) return true;
    const levels = currentModel.thinking_levels;
    if (Array.isArray(levels) && levels.length > 1) return true;
    if (Array.isArray(levels) && levels.length === 1 && levels[0] !== "off") return true;
    return false;
  }, [currentModel]);

  const effectiveThinkingLevel = useMemo(() => {
    if (!supportsThinking) return "off";
    return thinkingLevel || currentModel?.default_thinking_level || "medium";
  }, [supportsThinking, thinkingLevel, currentModel]);

  const draftTokens = text.trim().length > 0 ? Math.max(1, Math.ceil(text.trim().length / 3)) : 0;
  const contextTokensWithDraft = (currentContextTokens || 0) + draftTokens;
  const contextPercent = contextWindowLimit && contextWindowLimit > 0
    ? Math.min(100, Math.round((contextTokensWithDraft / contextWindowLimit) * 100))
    : null;

  return (
    <div className="tb-composer-wrapper">
      <div className={`tb-composer-box${isStreaming ? " is-active" : ""}`}>
        <div className="tb-composer-input-area">
          <textarea
            ref={textareaRef}
            className="tb-composer-textarea"
            value={text}
            onChange={(e) => {
              const next = e.target.value;
              setText(next);
              setCursor(e.target.selectionStart || next.length);
              setSlashDismissed(false);
              setMentionDismissed(false);
              setDirectoriesDismissed(false);
            }}
            onSelect={(e) => {
              setCursor(e.currentTarget.selectionStart || 0);
            }}
            onClick={(e) => {
              setCursor(e.currentTarget.selectionStart || 0);
            }}
            onKeyUp={(e) => {
              setCursor(e.currentTarget.selectionStart || 0);
            }}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            rows={1}
          />
        </div>

        {slashOpen ? (
          <ul
            id="chat-composer-slash-list"
            className="wb-terminal-composer-suggestions"
            role="listbox"
            aria-label="Slash commands"
          >
            {slashSuggestions.map((item, index) => (
              <li
                ref={(el) => {
                  slashItemRefs.current[index] = el;
                }}
                key={`${item.kind}:${item.name}`}
                id={`chat-slash-${index}`}
                role="option"
                aria-selected={index === activeSlash}
                className={`wb-terminal-composer-suggestion${index === activeSlash ? " is-active" : ""}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => acceptSlashSuggestion(item)}
              >
                <ThemeIcon
                  name={item.kind === "skill" ? "sparkles" : "wrench"}
                  size={ICON_SIZE.dense}
                />
                <span className="wb-terminal-composer-suggestion-text">/{item.name}</span>
                <span className="tb-composer-suggestion-badge">
                  {item.kind === "skill" ? "Skill" : "MCP"}
                </span>
                {item.description ? (
                  <span className="wb-terminal-composer-suggestion-desc">{item.description}</span>
                ) : null}
                <span className="wb-terminal-composer-suggestion-kbd" aria-hidden="true">Tab</span>
              </li>
            ))}
          </ul>
        ) : mentionOpen ? (
          <ul
            id="chat-composer-mention-list"
            className="wb-terminal-composer-suggestions"
            role="listbox"
            aria-label="Mention context"
          >
            {mentionSuggestions.map((item, index) => {
              const iconName =
                item.kind === "task"
                  ? "square-kanban"
                  : item.kind === "note"
                    ? "notebook"
                    : "message-square";
              return (
                <li
                  ref={(el) => {
                    mentionItemRefs.current[index] = el;
                  }}
                  key={`${item.kind}:${item.id}`}
                  id={`chat-mention-${index}`}
                  role="option"
                  aria-selected={index === activeMention}
                  className={`wb-terminal-composer-suggestion${index === activeMention ? " is-active" : ""}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => acceptMentionSuggestion(item)}
                >
                  <ThemeIcon name={iconName} size={ICON_SIZE.dense} />
                  <span className="wb-terminal-composer-suggestion-text">@{item.title}</span>
                  <span className="tb-composer-suggestion-badge">{item.badge}</span>
                  {item.subtitle ? (
                    <span className="wb-terminal-composer-suggestion-desc">{item.subtitle}</span>
                  ) : null}
                  <span className="wb-terminal-composer-suggestion-kbd" aria-hidden="true">Tab</span>
                </li>
              );
            })}
          </ul>
        ) : directoryOpen ? (
          <ul
            id="chat-composer-directory-list"
            className="wb-terminal-composer-suggestions"
            role="listbox"
            aria-label="Files and directories"
          >
            {directoryLoading ? (
              <li className="wb-terminal-composer-suggestion" role="option" aria-disabled="true">
                <span className="wb-terminal-composer-suggestion-text">正在加载目录内容...</span>
              </li>
            ) : directoryError ? (
              <li className="wb-terminal-composer-suggestion" role="option" aria-disabled="true">
                <span className="wb-terminal-composer-suggestion-text">{directoryError}</span>
              </li>
            ) : directorySuggestions.length > 0 ? (
              directorySuggestions.map((suggestion, index) => {
                const isDir = suggestion.kind === "directory" || suggestion.kind === "project";
                const iconName =
                  suggestion.kind === "project" ? "square-kanban" : isDir ? "folder" : "file-code";
                const displayLabel =
                  suggestion.kind === "project"
                    ? suggestion.label
                    : `#${suggestion.relativePath}${isDir ? "/" : ""}`;
                return (
                  <li
                    ref={(el) => {
                      directoryItemRefs.current[index] = el;
                    }}
                    key={suggestion.kind === "project" ? suggestion.path : suggestion.relativePath}
                    id={`chat-directory-${index}`}
                    role="option"
                    aria-selected={index === activeDirectory}
                    className={`wb-terminal-composer-suggestion${index === activeDirectory ? " is-active" : ""}`}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => acceptDirectory(suggestion)}
                  >
                    <ThemeIcon name={iconName} size={ICON_SIZE.dense} />
                    <span className="wb-terminal-composer-suggestion-text">{displayLabel}</span>
                    <span className="tb-composer-suggestion-badge">
                      {suggestion.kind === "project" ? "项目" : isDir ? "目录" : "文件"}
                    </span>
                    {suggestion.kind === "project" ? (
                      <span className="wb-terminal-composer-suggestion-desc">{suggestion.path}</span>
                    ) : null}
                    <span className="wb-terminal-composer-suggestion-kbd" aria-hidden="true">
                      {isDir ? "Tab · →" : "Tab"}
                    </span>
                  </li>
                );
              })
            ) : (
              <li className="wb-terminal-composer-suggestion" role="option" aria-disabled="true">
                <span className="wb-terminal-composer-suggestion-text">无匹配文件或目录</span>
              </li>
            )}
          </ul>
        ) : null}

        {/* Token, Cache & Speed Statistics Bar (Always Visible) */}
        <div className="tb-composer-metrics-bar">
          <div className="tb-metrics-group tb-metrics-left">
            {isStreaming ? (
              <>
                <span className="tb-metrics-pulse" />
                <span className="tb-metrics-speed">
                  ⚡ {typeof streamingMetrics?.tps === "number" && Number.isFinite(streamingMetrics.tps) ? streamingMetrics.tps.toFixed(1) : "0.0"} tok/s
                </span>
                <span className="tb-metrics-divider" />
                <span className="tb-metrics-tokens">
                  {typeof streamingMetrics?.tokensCount === "number" ? streamingMetrics.tokensCount : 0} tokens
                </span>
              </>
            ) : lastRunMetrics && (typeof lastRunMetrics.totalTokens === "number" || typeof lastRunMetrics.tps === "number") ? (
              <>
                {typeof lastRunMetrics.tps === "number" && Number.isFinite(lastRunMetrics.tps) && lastRunMetrics.tps > 0 ? (
                  <>
                    <span className="tb-metrics-speed">
                      ⚡ {lastRunMetrics.tps.toFixed(1)} tok/s
                    </span>
                    <span className="tb-metrics-divider" />
                  </>
                ) : null}
                <span className="tb-metrics-tokens">
                  Turn: {lastRunMetrics.totalTokens !== undefined ? `${lastRunMetrics.totalTokens.toLocaleString()}` : null}
                  {lastRunMetrics.promptTokens !== undefined && lastRunMetrics.completionTokens !== undefined ? (
                    <span className="tb-metrics-breakdown">
                      {" "}(In {lastRunMetrics.promptTokens.toLocaleString()} · Out {lastRunMetrics.completionTokens.toLocaleString()})
                    </span>
                  ) : null}
                </span>
                {typeof lastRunMetrics.cachedTokens === "number" && lastRunMetrics.cachedTokens > 0 ? (
                  <>
                    <span className="tb-metrics-divider" />
                    <span className="tb-metrics-cache-badge" title="Prompt Cache 命中数量">
                      <ThemeIcon name="zap" size={ICON_SIZE.inline} />
                      Cache {lastRunMetrics.cachedTokens.toLocaleString()}
                      {typeof lastRunMetrics.promptTokens === "number" && lastRunMetrics.promptTokens > 0 ? (
                        ` (${Math.round((lastRunMetrics.cachedTokens / lastRunMetrics.promptTokens) * 100)}%)`
                      ) : null}
                    </span>
                  </>
                ) : null}
              </>
            ) : (
              <span className="tb-metrics-speed">⚡ Ready</span>
            )}
          </div>

          <div className="tb-metrics-group tb-metrics-right">
            {/* 上下文占用 */}
            <span
              className="tb-metrics-context"
              title={`当前上下文占用 / 模型窗口上限: ${contextTokensWithDraft.toLocaleString()}${contextWindowLimit ? ` / ${contextWindowLimit.toLocaleString()}` : ""}`}
            >
              <ThemeIcon name="notebook" size={ICON_SIZE.inline} />
              <span>上下文: </span>
              <span className="tb-metrics-value">
                {formatTokenCount(contextTokensWithDraft)}
                {contextWindowLimit ? ` / ${formatCompactTokens(contextWindowLimit)}` : ""}
              </span>
              {contextPercent !== null && (
                <span className={`tb-metrics-percent${contextPercent >= 80 ? " is-warning" : ""}`}>
                  ({contextPercent}%)
                </span>
              )}
            </span>

            <span className="tb-metrics-divider" />

            {/* 对话累计总消耗 */}
            <span
              className="tb-metrics-total"
              title="当前对话全部轮次累计消耗的总 Token 数"
            >
              <span>总消耗: </span>
              <span className="tb-metrics-value">
                {(sessionTotalTokens || 0).toLocaleString()}
              </span>
            </span>
          </div>
        </div>

        <div className="tb-composer-toolbar">
          <div className="tb-composer-tools-left">
            {/* Model Selector Chip */}
            <div className="tb-composer-chip">
              <ThemeIcon name="bot" size={ICON_SIZE.inline} />
              <NativeMenuSelect
                className="tb-composer-native-select"
                value={selectedModel || (models[0]?.selection_id ?? "mock")}
                options={modelOptions}
                onChange={onSelectModel}
                disabled={isStreaming}
                ariaLabel="Select Model"
                title={selectedModel || "Select Model"}
              />
            </div>

            {/* Thinking Level Chip */}
            <div className={`tb-composer-chip${!supportsThinking ? " tb-chip-disabled" : ""}`}>
              <ThemeIcon name="sparkles" size={ICON_SIZE.inline} />
              <NativeMenuSelect
                className="tb-composer-native-select"
                value={effectiveThinkingLevel}
                options={thinkingOptions}
                onChange={onSelectThinkingLevel}
                disabled={isStreaming || !supportsThinking || thinkingOptions.length <= 1}
                ariaLabel="Thinking Level"
                title={
                  supportsThinking
                    ? `Thinking Level: ${effectiveThinkingLevel}`
                    : "Thinking not supported by this model"
                }
              />
            </div>

            {/* Workspace Selector Chip */}
            <button
              ref={workspaceButtonRef}
              type="button"
              className={`tb-composer-chip${workspaceLocked ? " tb-chip-locked" : " tb-chip-button"}`}
              onClick={handleOpenWorkspaceMenu}
              disabled={isStreaming || workspaceLocked}
              title={workspaceTitle}
              aria-label="选择工作区"
            >
              <ThemeIcon
                name={workspaceSource === "gtd" ? "square-kanban" : "folder"}
                size={ICON_SIZE.inline}
              />
              <span className="tb-chip-label">{workspaceLabel}</span>
              {!workspaceLocked && (
                <ThemeIcon name="chevron-down" size={ICON_SIZE.inline} aria-hidden="true" />
              )}
            </button>

            {/* Mock Mode Toggle Chip */}
            <button
              type="button"
              className={`tb-composer-chip tb-chip-button${useMock ? " is-active-mock" : ""}`}
              onClick={() => onToggleMock(!useMock)}
              disabled={isStreaming}
              title="Toggle Mock execution without calling LLM APIs"
            >
              <ThemeIcon name="sparkles" size={ICON_SIZE.inline} />
              <span className="tb-chip-label">{useMock ? "Mock Mode (ON)" : "Mock Mode"}</span>
            </button>
          </div>

          <div className="tb-composer-tools-right">
            <button
              type="button"
              className={`tb-composer-action-btn${isStreaming ? " is-stop" : ""}${!isStreaming && !text.trim() ? " is-disabled" : ""}`}
              onClick={handleSendClick}
              disabled={!isStreaming && !text.trim()}
              aria-label={isStreaming ? "Stop task" : "Send message"}
              title={isStreaming ? "Stop task" : "Send (Enter)"}
            >
              {isStreaming ? (
                <span className="tb-stop-icon" />
              ) : (
                <ThemeIcon name="arrow-up" size={ICON_SIZE.dense} />
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
