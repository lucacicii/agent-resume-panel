import React, { useRef, useState, useEffect, useMemo, useCallback } from "react";
import { ICON_SIZE, ThemeIcon } from "../../components/ThemeIcon";
import { NativeMenuSelect } from "../../components/NativeMenuSelect";
import { showContextMenuAt, type NativeContextMenuItem } from "../../nativeContextMenu";
import { desktopApi } from "../../bridge";
import type {
  AgentToolDescriptor,
  SkillDescriptor,
  ThunderImageAttachment,
  ThunderModelInfo,
  ThunderPermissionMode
} from "@agent-resume/core";
import { THUNDER_PERMISSION_MODES } from "@agent-resume/core/browser";
import type { WorkbenchComposerMention } from "@agent-resume/core";
import { normalizeComposerMentions } from "../../workspacePacks";
import {
  DEFAULT_WORKBENCH_MENTION_SOURCES,
  normalizeWorkbenchMentionSources
} from "@agent-resume/core/browser";
import type { WorkbenchMentionSources } from "@agent-resume/core";
import { buildMentionSuggestions, GTD_STATUS_LABELS, sortGtdTasks, type ChatMentionSuggestion } from "./composerMentions";
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


export interface PendingChatImage {
  id: string;
  name: string;
  mimeType: string;
  previewUrl: string;
  path?: string;
  data?: string;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

function electronPath(file: File): string | undefined {
  const value = (file as File & { path?: string }).path;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

const ALLOWED_IMAGE_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif"
]);
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_PENDING_IMAGES = 10;

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


/**
 * Chip labels for the two approval modes, in `Shift+Tab` order.
 *
 * Kept short because they are what the *trigger* shows; the meaning lives in
 * `PERMISSION_MODE_HINTS`, which only fits in a menu or a tooltip.
 */
const PERMISSION_MODE_LABELS: Record<ThunderPermissionMode, string> = {
  plan: "Plan",
  yolo: "YOLO"
};

/**
 * One line per mode — Thunder implements these two and nothing between them.
 *
 * `plan` and `yolo` are opposites, which is the argument for spelling them out
 * rather than trusting the name: one refuses every write, the other asks
 * nothing at all.
 */
const PERMISSION_MODE_HINTS: Record<ThunderPermissionMode, string> = {
  plan: "Read-only. Writes are refused — the plan text is the deliverable",
  yolo: "Never asks — every call runs"
};


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
  onSend: (
    prompt: string,
    options?: {
      workspaceDir?: string;
      model?: string;
      thinking_level?: string;
      attachments?: ThunderImageAttachment[];
      /** Other `@pack` directories cited in the same message, granted as extra roots. */
      extraWorkspaceDirs?: string[];
      /**
       * What the agent receives, when it differs from the text on screen: the
       * compiled context blocks (@note / #file / skill instructions). The shown
       * message stays the user's own words.
       */
      agentPrompt?: string;
    }
  ) => void;
  onCancel: () => void;
  isStreaming: boolean;
  /**
   * Pause at the next tool boundary / resume a paused run. The banner only
   * flips when the daemon's `task_paused` frame arrives — the tool in flight
   * still runs to completion, so the button must not pretend an instant pause.
   */
  pausedTask?: { taskId: string; reason: string } | null;
  onPauseTask?: () => void;
  onResumeTask?: () => void;
  /**
   * Queue text into the running task.
   *
   * `steer` enters at the next turn boundary (after the tool calls already in
   * flight), `follow_up` only once the run has nothing else to do. Optional so
   * a host that cannot steer simply behaves as before.
   */
  onSteer?: (message: string, attachments?: ThunderImageAttachment[]) => void;
  onFollowUp?: (message: string, attachments?: ThunderImageAttachment[]) => void;
  /** Pending queue size, for the badge. */
  queuedCount?: number;
  models: ThunderModelInfo[];
  selectedModel: string;
  onSelectModel: (model: string) => void;
  thinkingLevel: string;
  onSelectThinkingLevel: (level: string) => void;
  /**
   * The approval mode this session is judged by, and how to change it.
   *
   * Optional so the composer still renders where a host has no mode to show;
   * the chip simply does not appear. `""` means "not hydrated yet" (the daemon
   * holds the truth per session), which the chip renders as unknown rather
   * than guessing.
   */
  permissionMode?: ThunderPermissionMode | "";
  onSelectPermissionMode?: (mode: ThunderPermissionMode) => void;
  workspaceDir: string;
  onSelectWorkspaceDir: (dir: string) => void;
  workspaceSource?: "finder" | "gtd";
  taskNoteId?: string | null;
  onSelectGtdTask?: (noteId: string, dir: string) => void;
  onSelectFinderDir?: (dir: string) => void;
  workspaceLocked?: boolean;
  /**
   * Whether the composer offers the workspace / GTD picker chip. Board chat and
   * Quick Agent turn it off: there the workspace comes from `@pack` mentions or a
   * folder dropped on the composer, never from a scope control.
   */
  showWorkspacePicker?: boolean;
  placeholder?: string;
  prefillPrompt?: { text: string; id: number } | null;
  lastRunMetrics?: ChatRunMetrics | null;
  streamingMetrics?: { tokensCount: number; tps: number; reasoningCount?: number } | null;
  sessionTotalTokens?: number;
  currentContextTokens?: number;
  contextWindowLimit?: number;
  /**
   * Content docked directly above the composer box inside the floating
   * wrapper (e.g. the agent question card), so it rides the same layer and
   * can never be covered by the input.
   */
  docked?: React.ReactNode;
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

/** Format a duration for the "总耗时" badge: 3.2s / 45s / 1m 05s / 1h 02m. */
function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const totalSec = ms / 1000;
  if (totalSec < 60) {
    const sec = Math.floor(totalSec);
    const frac = totalSec - sec;
    // Sub-minute durations keep one decimal for a sense of precision
    return frac >= 0.05 ? `${totalSec.toFixed(1)}s` : `${sec}s`;
  }
  const totalMin = Math.floor(totalSec / 60);
  if (totalMin < 60) {
    const remSec = Math.round(totalSec % 60);
    return remSec === 60
      ? `${totalMin + 1}m`
      : `${totalMin}m ${String(remSec).padStart(2, "0")}s`;
  }
  const hours = Math.floor(totalMin / 60);
  const remMin = Math.round(totalMin % 60);
  return remMin === 60 ? `${hours + 1}h` : `${hours}h ${String(remMin).padStart(2, "0")}m`;
}

export function ChatComposer({
  onSend,
  onCancel,
  isStreaming,
  pausedTask,
  onPauseTask,
  onResumeTask,
  onSteer,
  onFollowUp,
  queuedCount,
  models,
  selectedModel,
  onSelectModel,
  thinkingLevel,
  onSelectThinkingLevel,
  permissionMode = "",
  onSelectPermissionMode,
  workspaceDir,
  onSelectWorkspaceDir,
  workspaceSource = "finder",
  taskNoteId,
  onSelectGtdTask,
  onSelectFinderDir,
  workspaceLocked = false,
  showWorkspacePicker = true,
  placeholder = "Ask Thunder agent anything, or type / for skills/mcp, @ for context, # for files...",
  prefillPrompt,
  lastRunMetrics,
  streamingMetrics,
  sessionTotalTokens = 0,
  currentContextTokens = 0,
  contextWindowLimit,
  docked
}: ChatComposerProps) {
  const [text, setText] = useState("");
  const [cursor, setCursor] = useState(0);
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [skills, setSkills] = useState<SkillDescriptor[]>([]);
  const [tools, setTools] = useState<AgentToolDescriptor[]>([]);
  const [notes, setNotes] = useState<Array<{ id: string; title: string; folder?: string }>>([]);
  const [conversations, setConversations] = useState<Array<{ id: string; title?: string; message_count?: number }>>([]);
  const [referencedMentions, setReferencedMentions] = useState<ChatMentionSuggestion[]>([]);
  /**
   * Workspace packs (`@anfeng`): the only mention that points the conversation
   * at a directory, since the board chat and Quick Agent carry no workspace
   * picker. Catalog projects stay out — Settings promotes one into a pack.
   */
  const [workspacePacks, setWorkspacePacks] = useState<WorkbenchComposerMention[]>([]);
  /**
   * Which kinds the `@` menu lists. Read here too: the composer compiles a
   * mention's content, so it must not offer a kind it would then ignore.
   */
  const [mentionSourcesEnabled, setMentionSourcesEnabled] = useState<WorkbenchMentionSources>(
    DEFAULT_WORKBENCH_MENTION_SOURCES
  );

  /**
   * Packs and their switches live in Settings, so an open composer has to hear
   * about edits: without this, a pack added while a chat is on screen would stay
   * invisible until the composer remounted. `settings-closed` is the event the
   * settings panel already dispatches, and it covers every pane.
   */
  useEffect(() => {
    let cancelled = false;
    const loadMentionSettings = async () => {
      try {
        const settings = await desktopApi().getSettings();
        if (cancelled) return;
        setWorkspacePacks(normalizeComposerMentions(settings?.workbench?.composerMentions));
        setMentionSourcesEnabled(
          normalizeWorkbenchMentionSources(settings?.workbench?.composerMentionSources)
        );
      } catch (err) {
        console.warn("Failed to read workspace packs:", err);
      }
    };
    void loadMentionSettings();
    const handleSettingsClosed = () => {
      void loadMentionSettings();
    };
    window.addEventListener("agent-resume:settings-closed", handleSettingsClosed);
    return () => {
      cancelled = true;
      window.removeEventListener("agent-resume:settings-closed", handleSettingsClosed);
    };
  }, []);
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
  const composerRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const workspaceButtonRef = useRef<HTMLButtonElement | null>(null);
  const slashItemRefs = useRef<Array<HTMLLIElement | null>>([]);
  const mentionItemRefs = useRef<Array<HTMLLIElement | null>>([]);
  const directoryItemRefs = useRef<Array<HTMLLIElement | null>>([]);

  const [pendingImages, setPendingImages] = useState<PendingChatImage[]>([]);
  const [imagePreview, setImagePreview] = useState<string | null>(null);

  const removePendingImage = useCallback((id: string) => {
    setPendingImages((prev) => prev.filter((img) => img.id !== id));
  }, []);

  const handlePaste = useCallback(
    async (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const items = [...(event.clipboardData?.items ?? [])];
      const imageItems = items.filter((item) => item.type.startsWith("image/"));
      if (!imageItems.length) return;

      event.preventDefault();
      const next: PendingChatImage[] = [];
      let currentCount = pendingImages.length;

      for (const item of imageItems) {
        if (currentCount >= MAX_PENDING_IMAGES) break;
        const file = item.getAsFile();
        if (!file) continue;

        if (file.size > MAX_IMAGE_BYTES) {
          console.warn(`Image ${file.name} exceeds 5MB limit`);
          continue;
        }

        const mimeType = file.type || "image/png";
        if (!ALLOWED_IMAGE_MIME.has(mimeType.toLowerCase())) continue;

        const dataUrl = await readFileAsDataUrl(file);
        const data = dataUrl.split(",")[1] || "";
        const filePath = electronPath(file);

        next.push({
          id: `img_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          name: file.name || "Pasted Image",
          mimeType,
          previewUrl: dataUrl,
          path: filePath,
          data
        });
        currentCount += 1;
      }

      if (next.length > 0) {
        setPendingImages((prev) => [...prev, ...next]);
      }
    },
    [pendingImages.length]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.types.includes("Files")) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    }
  }, []);

  /**
   * A folder dropped from Finder points the conversation at it.
   *
   * Images keep their own path (attachments), so the two drop targets never
   * fight: a directory binds the workspace and stops there, anything else falls
   * through to the attachment handler below.
   */
  const droppedDirectoryPath = (transfer: DataTransfer): string => {
    const item = Array.from(transfer.items || []).find((entry) => entry.kind === "file");
    const entry = item?.webkitGetAsEntry?.();
    if (!entry?.isDirectory) return "";
    const file = transfer.files?.[0] as (File & { path?: string }) | undefined;
    return typeof file?.path === "string" ? file.path : "";
  };

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      // 1. Dropped Kanban task card
      const rawTask = e.dataTransfer.getData("application/x-agent-resume-task");
      if (rawTask) {
        e.preventDefault();
        try {
          const taskData = JSON.parse(rawTask) as { noteId?: string; id?: string; title?: string; gtdStatus?: string };
          const noteId = taskData.noteId || taskData.id;
          const title = taskData.title || noteId || "任务";
          const mentionText = `@task:${title} `;
          setText((prev) => {
            const trimmed = prev ? prev.trimEnd() : "";
            return trimmed ? `${trimmed} ${mentionText}` : mentionText;
          });
          if (noteId) {
            setReferencedMentions((prev) => {
              if (prev.some((m) => m.id === noteId)) return prev;
              return [
                ...prev,
                {
                  kind: "task",
                  id: noteId,
                  title,
                  badge: "Task",
                  gtdStatus: taskData.gtdStatus
                }
              ];
            });
          }
          requestAnimationFrame(() => {
            textareaRef.current?.focus();
          });
          return;
        } catch {
          /* continue */
        }
      }

      // 2. Dropped Note document
      const rawNote = e.dataTransfer.getData("application/x-agent-resume-note");
      if (rawNote) {
        e.preventDefault();
        try {
          const noteData = JSON.parse(rawNote) as { noteId?: string; title?: string };
          const noteId = noteData.noteId;
          const title = noteData.title || noteId || "笔记";
          const mentionText = `@note:${title} `;
          setText((prev) => {
            const trimmed = prev ? prev.trimEnd() : "";
            return trimmed ? `${trimmed} ${mentionText}` : mentionText;
          });
          if (noteId) {
            setReferencedMentions((prev) => {
              if (prev.some((m) => m.id === noteId)) return prev;
              return [
                ...prev,
                {
                  kind: "note",
                  id: noteId,
                  title,
                  badge: "Note"
                }
              ];
            });
          }
          requestAnimationFrame(() => {
            textareaRef.current?.focus();
          });
          return;
        } catch {
          /* continue */
        }
      }

      const directory = droppedDirectoryPath(e.dataTransfer);
      if (directory) {
        e.preventDefault();
        if (onSelectFinderDir) onSelectFinderDir(directory);
        else onSelectWorkspaceDir(directory);
        window.dispatchEvent(
          new CustomEvent("agent-resume:workspace-context-changed", {
            detail: { id: directory.split("/").filter(Boolean).pop(), path: directory }
          })
        );
        return;
      }
      const files = Array.from(e.dataTransfer.files || []);
      const imageFiles = files.filter(
        (f) => f.type.startsWith("image/") || /\.(png|jpe?g|webp|gif)$/i.test(f.name)
      );
      if (!imageFiles.length) return;

      e.preventDefault();
      const next: PendingChatImage[] = [];
      let currentCount = pendingImages.length;

      for (const file of imageFiles) {
        if (currentCount >= MAX_PENDING_IMAGES) break;
        if (file.size > MAX_IMAGE_BYTES) {
          console.warn(`Image ${file.name} exceeds 5MB limit`);
          continue;
        }
        const mimeType = file.type || "image/png";
        if (file.type && !ALLOWED_IMAGE_MIME.has(mimeType.toLowerCase())) continue;

        const dataUrl = await readFileAsDataUrl(file);
        const data = dataUrl.split(",")[1] || "";
        const filePath = electronPath(file);

        next.push({
          id: `img_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          name: file.name,
          mimeType,
          previewUrl: dataUrl,
          path: filePath,
          data
        });
        currentCount += 1;
      }

      if (next.length > 0) {
        setPendingImages((prev) => [...prev, ...next]);
      }
    },
    [pendingImages.length]
  );

  const handleFileInputChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files || []);
      if (!files.length) return;

      const next: PendingChatImage[] = [];
      let currentCount = pendingImages.length;

      for (const file of files) {
        if (currentCount >= MAX_PENDING_IMAGES) break;
        if (file.size > MAX_IMAGE_BYTES) {
          console.warn(`Image ${file.name} exceeds 5MB limit`);
          continue;
        }
        const mimeType = file.type || "image/png";
        if (file.type && !ALLOWED_IMAGE_MIME.has(mimeType.toLowerCase())) continue;

        const dataUrl = await readFileAsDataUrl(file);
        const data = dataUrl.split(",")[1] || "";
        const filePath = electronPath(file);

        next.push({
          id: `img_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          name: file.name,
          mimeType,
          previewUrl: dataUrl,
          path: filePath,
          data
        });
        currentCount += 1;
      }

      if (next.length > 0) {
        setPendingImages((prev) => [...prev, ...next]);
      }
      e.target.value = "";
    },
    [onSelectFinderDir, onSelectWorkspaceDir, pendingImages.length]
  );

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
          description: (s.description || "Skill").replace(/^[>|][+-]?\s*/, "").trim(),
          location: s.location
        });
      }
    }

    const nativeCommands: ChatSlashSuggestion[] = [
      {
        kind: "mcp",
        name: "gtd",
        description: "在右侧舞台打开原生 GTD 任务看板 (Native Kanban)"
      },
      {
        kind: "mcp",
        name: "tasks",
        description: "查看当前工程的任务看板 (Native Tasks)"
      }
    ];

    for (const nc of nativeCommands) {
      if (!q || nc.name.includes(q) || nc.description?.toLowerCase().includes(q)) {
        out.push(nc);
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
    return buildMentionSuggestions(atToken.query, {
      packs: workspacePacks,
      tasks,
      notes,
      conversations,
      enabled: mentionSourcesEnabled
    });
  }, [atToken, tasks, notes, conversations, workspacePacks, mentionSourcesEnabled]);

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

  /**
   * Point the conversation at a directory without a scope control.
   *
   * A workspace pack also carries read-only references, so it stays in
   * `referencedMentions` and `compileChatPrompt` appends its block; a plain
   * project only moves the workspace.
   */
  const bindMentionDirectory = useCallback(
    (item: ChatMentionSuggestion) => {
      const target = item.path;
      if (!target) return;
      if (onSelectFinderDir) {
        onSelectFinderDir(target);
      } else {
        try {
          localStorage.setItem("chat-selected-workspace", target);
        } catch {
          // ignore
        }
        onSelectWorkspaceDir(target);
      }
      // The conversation keeps going; only its working directory moved, and the
      // user is told so rather than silently running in another repo.
      window.dispatchEvent(
        new CustomEvent("agent-resume:workspace-context-changed", {
          detail: { id: item.title, path: target }
        })
      );
    },
    [onSelectFinderDir, onSelectWorkspaceDir]
  );

  const acceptMentionSuggestion = useCallback(
    (item: ChatMentionSuggestion) => {
      if (!atToken) return;
      if (item.kind === "workspace") {
        bindMentionDirectory(item);
      }
      // A task is the multi-repository container: binding it lets the run inherit
      // every repository the task references (plus its context and worktree rule),
      // which is more than pasting the note body into the prompt ever did.
      const boundTask = item.kind === "task" && Boolean(onSelectGtdTask);
      if (boundTask) {
        const task = tasks.find((entry) => entry.noteId === item.id);
        const primary = task?.work?.primaryProject || task?.work?.projects?.[0] || "";
        void (async () => {
          const dir = primary || (await desktopApi().homePath().catch(() => ""));
          if (!dir) return;
          onSelectGtdTask?.(item.id, dir);
          window.dispatchEvent(
            new CustomEvent("agent-resume:workspace-context-changed", {
              detail: { id: item.title, path: dir }
            })
          );
        })();
      }
      const inserted = `@${item.title} `;
      const next = `${text.slice(0, atToken.start)}${inserted}${text.slice(cursor)}`;
      const nextCursor = atToken.start + inserted.length;
      setText(next);
      setMentionDismissed(true);
      setActiveMention(0);
      // A bound task supplies its own context on the run, so it is not kept as
      // a mention; every other kind contributes a block to the prompt.
      if (!boundTask) setReferencedMentions((prev) => [...prev, item]);
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (el) {
          el.focus();
          el.setSelectionRange(nextCursor, nextCursor);
        }
        setCursor(nextCursor);
      });
    },
    [atToken, bindMentionDirectory, cursor, onSelectGtdTask, tasks, text]
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

  const triggerKanbanArtifact = useCallback(() => {
    void desktopApi().notesListTasks?.().then((res) => {
      const tasks = Array.isArray(res) ? res : (res as any)?.tasks || [];
      window.dispatchEvent(
        new CustomEvent("agent-resume:stage-artifact", {
          detail: {
            id: "artifact-task-kanban",
            version: "1.0",
            title: "任务看板",
            target: "stage",
            kind: "native:gtd",
            payload: tasks
          }
        })
      );
    });
  }, []);

  const triggerNotesArtifact = useCallback(() => {
    void desktopApi().notesList?.().then((res) => {
      const notes = Array.isArray(res) ? res : [];
      window.dispatchEvent(
        new CustomEvent("agent-resume:stage-artifact", {
          detail: {
            id: "artifact-notes-tree",
            version: "1.0",
            title: "知识库笔记",
            target: "stage",
            kind: "native:notes",
            payload: notes
          }
        })
      );
    });
  }, []);

  const triggerDiffArtifact = useCallback(() => {
    window.dispatchEvent(
      new CustomEvent("agent-resume:stage-artifact", {
        detail: {
          id: "artifact-git-diff",
          version: "1.0",
          title: "代码改动",
          target: "stage",
          kind: "native:diff",
          payload: { workspaceDir }
        }
      })
    );
  }, [workspaceDir]);

  const triggerBrowserArtifact = useCallback(() => {
    window.dispatchEvent(
      new CustomEvent("agent-resume:stage-artifact", {
        detail: {
          id: "artifact-browser",
          version: "1.0",
          title: "内置浏览器",
          target: "stage",
          kind: "native:browser",
          payload: {}
        }
      })
    );
  }, []);

  const triggerMemoryArtifact = useCallback(() => {
    window.dispatchEvent(
      new CustomEvent("agent-resume:stage-artifact", {
        detail: {
          id: "artifact-memory",
          version: "1.0",
          title: "认知与记忆",
          target: "stage",
          kind: "native:memory",
          payload: {}
        }
      })
    );
  }, []);

  const triggerScriptsArtifact = useCallback(() => {
    const projects = workspaceProjects.length > 0 ? workspaceProjects : (workspaceDir ? [workspaceDir] : []);
    window.dispatchEvent(
      new CustomEvent("agent-resume:stage-artifact", {
        detail: {
          id: "artifact-scripts",
          version: "1.0",
          title: "可执行脚本",
          target: "stage",
          kind: "native:scripts",
          payload: {
            workspaceDir,
            projects
          }
        }
      })
    );
  }, [workspaceDir, workspaceProjects]);

  // Listen for cross-artifact append events
  useEffect(() => {
    const onAppend = (event: Event) => {
      const detail = (event as CustomEvent<{ text: string; mention?: ChatMentionSuggestion }>).detail;
      if (detail && detail.text) {
        setText((prev) => {
          const trimmed = prev ? prev.trimEnd() : "";
          return trimmed ? `${trimmed} ${detail.text}` : detail.text;
        });
        if (detail.mention) {
          setReferencedMentions((prev) => {
            if (prev.some((m) => m.id === detail.mention!.id)) return prev;
            return [...prev, detail.mention!];
          });
        }
        requestAnimationFrame(() => {
          textareaRef.current?.focus();
        });
      }
    };
    window.addEventListener("agent-resume:composer-append", onAppend);
    return () => window.removeEventListener("agent-resume:composer-append", onAppend);
  }, []);

  // Global shortcuts for Artifact Stage (pure client-side stage toggle)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey) {
        if (e.key === "1") {
          e.preventDefault();
          triggerKanbanArtifact();
        } else if (e.key === "2") {
          e.preventDefault();
          triggerNotesArtifact();
        } else if (e.key === "3") {
          e.preventDefault();
          triggerBrowserArtifact();
        } else if (e.key === "4") {
          e.preventDefault();
          triggerMemoryArtifact();
        } else if (e.key === "5") {
          e.preventDefault();
          triggerScriptsArtifact();
        } else if (e.key.toLowerCase() === "d") {
          e.preventDefault();
          triggerDiffArtifact();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    triggerKanbanArtifact,
    triggerNotesArtifact,
    triggerDiffArtifact,
    triggerBrowserArtifact,
    triggerMemoryArtifact,
    triggerScriptsArtifact
  ]);

  const doSend = async () => {
    if (isStreaming) {
      onCancel();
      return;
    }
    const currentText = text.trim();
    if (!currentText && pendingImages.length === 0) return;

    // Pure local client-side commands: intercept /gtd, /tasks, /kanban, /notes, /diff, /browser, /memory, /scripts
    // Immediately open the native artifact on the Stage, clear text, and NEVER send to LLM
    const localCmdMatch = currentText.match(/^\/([a-zA-Z0-9_-]+)\s*$/);
    if (localCmdMatch) {
      const cmd = localCmdMatch[1].toLowerCase();
      if (cmd === "gtd" || cmd === "tasks" || cmd === "kanban") {
        setText("");
        triggerKanbanArtifact();
        return;
      }
      if (cmd === "notes") {
        setText("");
        triggerNotesArtifact();
        return;
      }
      if (cmd === "diff" || cmd === "changes") {
        setText("");
        triggerDiffArtifact();
        return;
      }
      if (cmd === "browser") {
        setText("");
        triggerBrowserArtifact();
        return;
      }
      if (cmd === "memory") {
        setText("");
        triggerMemoryArtifact();
        return;
      }
      if (cmd === "scripts") {
        setText("");
        triggerScriptsArtifact();
        return;
      }
    }

    setText("");
    const mentionsToCompile = [...referencedMentions];
    const filesToCompile = [...referencedFiles];
    const attachmentsToSend: ThunderImageAttachment[] = pendingImages.map((img) => ({
      name: img.name,
      mimeType: img.mimeType,
      path: img.path,
      data: img.data
    }));
    setReferencedMentions([]);
    setReferencedFiles([]);
    setPendingImages([]);

    // Every `@pack` cited in this message. The bound workspace is the jail root;
    // the rest are granted as extra roots, so one message can edit and cross-check
    // several repositories that share no parent directory.
    const citedPacks = workspacePacks.filter((pack) =>
      new RegExp(`(^|\\s)@${pack.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=\\s|$)`).test(currentText)
    );
    const extraWorkspaceDirs = [...new Set(
      citedPacks
        .map((pack) => pack.cwd)
        .filter((dir) => dir && dir.replace(/[\\/]+$/, "") !== workspaceDir.replace(/[\\/]+$/, ""))
    )];
    try {
      const effectivePrompt = await compileChatPrompt(currentText, {
        workspaceDir,
        skills,
        tools,
        referencedMentions: mentionsToCompile,
        referencedFiles: filesToCompile
      });
      // The shown message is what the user typed; the compiled blocks travel
      // separately, so the transcript never turns into prompt syntax.
      onSend(currentText || "Please analyze the attached image.", {
        workspaceDir,
        model: selectedModel,
        thinking_level: thinkingLevel,
        extraWorkspaceDirs: extraWorkspaceDirs.length > 0 ? extraWorkspaceDirs : undefined,
        agentPrompt: effectivePrompt || undefined,
        attachments: attachmentsToSend.length > 0 ? attachmentsToSend : undefined
      });
    } catch (err) {
      console.warn("Failed to compile prompt context:", err);
      onSend(currentText || "Please analyze the attached image.", {
        workspaceDir,
        model: selectedModel,
        thinking_level: thinkingLevel,
        extraWorkspaceDirs: extraWorkspaceDirs.length > 0 ? extraWorkspaceDirs : undefined,
        attachments: attachmentsToSend.length > 0 ? attachmentsToSend : undefined
      });
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
        // A run is in flight: Enter steers it, Alt/Option+Enter queues a
        // follow-up. Neither interrupts the tool that is running.
        //
        // Staged images ride along, so "look at this screenshot" works the same
        // whether the run is idle or live.
        const attachments: ThunderImageAttachment[] = pendingImages.map((img) => ({
          name: img.name,
          mimeType: img.mimeType,
          path: img.path,
          data: img.data
        }));
        const trimmed = text.trim();
        const canQueue = Boolean(onSteer || onFollowUp);
        if ((!trimmed && attachments.length === 0) || !canQueue) return;
        const prompt =
          trimmed || (attachments.length > 0 ? "Please analyze the attached image." : "");
        const withAttachments = attachments.length > 0 ? attachments : undefined;
        if (e.altKey && onFollowUp) {
          onFollowUp(prompt, withAttachments);
        } else if (onSteer) {
          onSteer(prompt, withAttachments);
        }
        setText("");
        setPendingImages([]);
        return;
      }
      if (text.trim() || pendingImages.length > 0) {
        void doSend();
      }
    }

    // Shift+Tab cycles the approval mode. It sits *after* the three suggestion
    // menus on purpose: they claim a bare `Tab` to accept a completion without
    // asking about modifiers, so a Shift+Tab that arrives here is one no menu
    // wanted — menu priority is a matter of position, not of a flag.
    //
    // Shift+Enter is deliberately left alone: it still falls through to the
    // textarea's own newline.
    if (e.key === "Tab" && e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      cyclePermissionMode();
    }
  };

  const handleSendClick = () => {
    if (isStreaming) {
      onCancel();
    } else if (text.trim() || pendingImages.length > 0) {
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
        label: "从 Finder 指定本地目录...",
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
        // A chat's task cwd is the task's primary repository; a task without
        // one runs from home.
        const task = currentTasks.find((item) => item.noteId === selectedId);
        const primary = task?.work?.primaryProject || task?.work?.projects?.[0] || "";
        const dir = primary || (await desktopApi().homePath());
        if (onSelectGtdTask) {
          onSelectGtdTask(selectedId, dir);
        } else {
          onSelectWorkspaceDir(dir);
        }
      } catch (err) {
        console.warn("Failed to resolve the task's working directory:", err);
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

  /**
   * The modes, both of them, with the active one check-marked by
   * `NativeMenuSelect`. Listing the alternatives is the point: the chip alone
   * would say which mode is on, never what the other one means.
   */
  const permissionModeOptions = useMemo(
    () => THUNDER_PERMISSION_MODES.map((value) => ({ value, label: PERMISSION_MODE_LABELS[value] })),
    []
  );

  /** Walk `THUNDER_PERMISSION_MODES`, wrapping at the end. */
  const cyclePermissionMode = useCallback(() => {
    if (!onSelectPermissionMode) return;
    const current = permissionMode ? THUNDER_PERMISSION_MODES.indexOf(permissionMode) : -1;
    const next = THUNDER_PERMISSION_MODES[(current + 1) % THUNDER_PERMISSION_MODES.length];
    onSelectPermissionMode(next);
  }, [permissionMode, onSelectPermissionMode]);

  /**
   * Shift+Tab also works with the focus on the chip or anywhere else in the
   * composer, not only inside the textarea.
   *
   * The textarea's own handler runs first (React's listener sits on the root
   * container, below `window`), so `defaultPrevented` is the handshake between
   * the two: it is true exactly when the textarea already took the keystroke —
   * cycling there, or handing `Tab` to an open suggestion menu. One press
   * therefore cycles once, and a menu still wins.
   */
  useEffect(() => {
    if (!onSelectPermissionMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || !e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.defaultPrevented) return;
      const root = composerRef.current;
      if (!root || !root.contains(document.activeElement)) return;
      e.preventDefault();
      cyclePermissionMode();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cyclePermissionMode, onSelectPermissionMode]);

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
    <div
      ref={composerRef}
      className="tb-composer-wrapper"
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {docked ?? null}
      {isStreaming && pausedTask && onResumeTask && (
        <div className="tb-composer-paused" aria-label="Task paused">
          <span>
            <ThemeIcon name="pause" size={ICON_SIZE.inline} /> Task paused
            {pausedTask.reason ? ` · ${pausedTask.reason}` : ""}
          </span>
          <button type="button" className="tb-composer-paused-resume" onClick={onResumeTask}>
            Resume
          </button>
        </div>
      )}
      {isStreaming && (queuedCount ?? 0) > 0 && (
        <div className="tb-composer-queued" aria-label="Queued messages">
          <span><ThemeIcon name="inbox" size={ICON_SIZE.inline} /> {queuedCount} queued</span>
          <span>Enter steers · ⌥Enter follows up</span>
        </div>
      )}

      {/* Built-in Artifact Stage Plain Capsules above composer box */}
      <div className="tb-composer-stage-plain-capsules" aria-label="Artifact Stage Shortcuts">
        <button
          type="button"
          className="tb-composer-plain-capsule"
          onClick={triggerKanbanArtifact}
          title="切换任务看板 (⌘1)"
          aria-label="切换任务看板"
        >
          <ThemeIcon name="square-kanban" size={ICON_SIZE.dense} />
          <span>看板</span>
        </button>

        <button
          type="button"
          className="tb-composer-plain-capsule"
          onClick={triggerNotesArtifact}
          title="切换知识库笔记 (⌘2)"
          aria-label="切换知识库笔记"
        >
          <ThemeIcon name="notebook" size={ICON_SIZE.dense} />
          <span>笔记</span>
        </button>

        <button
          type="button"
          className="tb-composer-plain-capsule"
          onClick={triggerDiffArtifact}
          title="查看代码改动 (⌘D)"
          aria-label="查看代码改动"
        >
          <ThemeIcon name="git-branch" size={ICON_SIZE.dense} />
          <span>改动</span>
        </button>

        <button
          type="button"
          className="tb-composer-plain-capsule"
          onClick={triggerBrowserArtifact}
          title="打开内置浏览器 (⌘3)"
          aria-label="打开内置浏览器"
        >
          <ThemeIcon name="globe" size={ICON_SIZE.dense} />
          <span>浏览器</span>
        </button>

        <button
          type="button"
          className="tb-composer-plain-capsule"
          onClick={triggerMemoryArtifact}
          title="查看长期记忆与规则 (⌘4)"
          aria-label="查看长期记忆"
        >
          <ThemeIcon name="sparkles" size={ICON_SIZE.dense} />
          <span>记忆</span>
        </button>

        <button
          type="button"
          className="tb-composer-plain-capsule"
          onClick={triggerScriptsArtifact}
          title="工程可执行脚本 (⌘5)"
          aria-label="可执行脚本"
        >
          <ThemeIcon name="terminal" size={ICON_SIZE.dense} />
          <span>脚本</span>
        </button>
      </div>

      <div className={`tb-composer-box${isStreaming ? " is-active" : ""}`}>
        {pendingImages.length > 0 && (
          <div className="wb-terminal-composer-pending-images" aria-label="Attached images">
            {pendingImages.map((img) => (
              <div className="wb-terminal-composer-pending-image" key={img.id}>
                <button
                  type="button"
                  className="wb-terminal-composer-pending-image-open"
                  title={img.name}
                  onClick={() => setImagePreview(img.previewUrl)}
                >
                  <img src={img.previewUrl} alt={img.name} />
                </button>
                <button
                  type="button"
                  className="wb-terminal-composer-pending-image-remove"
                  title="Remove image"
                  aria-label="Remove image"
                  onClick={() => removePendingImage(img.id)}
                >
                  <ThemeIcon name="close" size={ICON_SIZE.inline} />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="tb-composer-input-area">
          <textarea
            ref={textareaRef}
            className="tb-composer-textarea"
            value={text}
            onPaste={handlePaste}
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
                  <ThemeIcon name="zap" size={ICON_SIZE.inline} /> {typeof streamingMetrics?.tps === "number" && Number.isFinite(streamingMetrics.tps) ? streamingMetrics.tps.toFixed(1) : "0.0"} tok/s
                </span>
                <span className="tb-metrics-divider" />
                <span className="tb-metrics-tokens">
                  {typeof streamingMetrics?.tokensCount === "number" ? streamingMetrics.tokensCount : 0} tokens
                  {typeof streamingMetrics?.reasoningCount === "number" && streamingMetrics.reasoningCount > 0 ? (
                    <span className="tb-metrics-breakdown">
                      {" "}(含思考 {streamingMetrics.reasoningCount.toLocaleString()})
                    </span>
                  ) : null}
                </span>
              </>
            ) : lastRunMetrics && (typeof lastRunMetrics.totalTokens === "number" || typeof lastRunMetrics.tps === "number") ? (
              <>
                {typeof lastRunMetrics.tps === "number" && Number.isFinite(lastRunMetrics.tps) && lastRunMetrics.tps > 0 ? (
                  <>
                    <span className="tb-metrics-speed">
                      <ThemeIcon name="zap" size={ICON_SIZE.inline} /> {lastRunMetrics.tps.toFixed(1)} tok/s
                    </span>
                    <span className="tb-metrics-divider" />
                  </>
                ) : null}
                <span className="tb-metrics-tokens">
                  Turn: {lastRunMetrics.totalTokens !== undefined ? `${lastRunMetrics.totalTokens.toLocaleString()}` : null}
                  {lastRunMetrics.promptTokens !== undefined && lastRunMetrics.completionTokens !== undefined ? (
                    <span className="tb-metrics-breakdown">
                      {" "}(In {lastRunMetrics.promptTokens.toLocaleString()} · Out {lastRunMetrics.completionTokens.toLocaleString()}
                      {typeof lastRunMetrics.reasoningTokens === "number" && lastRunMetrics.reasoningTokens > 0
                        ? ` (含思考 ${lastRunMetrics.reasoningTokens.toLocaleString()})`
                        : ""}
                      )
                    </span>
                  ) : null}
                </span>
              </>
            ) : (
              <span className="tb-metrics-speed"><ThemeIcon name="zap" size={ICON_SIZE.inline} /> Ready</span>
            )}

            {/* Prompt Cache 常显徽章：流式生成和空闲期间均持续显示，不再跳闪 */}
            {(() => {
              const cachedCount = typeof lastRunMetrics?.cachedTokens === "number" ? lastRunMetrics.cachedTokens : 0;
              const promptCount = typeof lastRunMetrics?.promptTokens === "number" ? lastRunMetrics.promptTokens : 0;
              const isHit = cachedCount > 0;
              const hitPercent = isHit && promptCount > 0 ? ((cachedCount / promptCount) * 100).toFixed(2) : null;
              const titleText = isStreaming
                ? isHit
                  ? `Prompt Cache: 上一轮已命中 ${cachedCount.toLocaleString()} tokens${hitPercent !== null ? ` (${hitPercent}%)` : ""}，本轮生成中...`
                  : "Prompt Cache: 本轮生成中..."
                : isHit
                  ? `Prompt Cache 命中: ${cachedCount.toLocaleString()} tokens${hitPercent !== null ? ` (${hitPercent}%)` : ""}`
                  : "Prompt Cache: 0 tokens (未命中缓存)";

              return (
                <>
                  <span className="tb-metrics-divider" />
                  <span
                    className={`tb-metrics-cache-badge${!isHit ? " is-zero" : ""}${isStreaming ? " is-streaming" : ""}`}
                    title={titleText}
                  >
                    <ThemeIcon name="zap" size={ICON_SIZE.inline} />
                    Cache {cachedCount.toLocaleString()}
                    {hitPercent !== null ? ` (${hitPercent}%)` : null}
                  </span>
                </>
              );
            })()}
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

            {/* 本轮任务总耗时：从发出消息到任务结束，发送新消息后重新计算 */}
            {typeof lastRunMetrics?.durationMs === "number" && Number.isFinite(lastRunMetrics.durationMs) ? (
              <>
                <span className="tb-metrics-divider" />
                <span
                  className="tb-metrics-total tb-metrics-duration"
                  title="本轮耗时：从你发出消息到 agent 结束任务（含排队与工具执行），发送新消息后重新计算"
                >
                  <ThemeIcon name="clock" size={ICON_SIZE.inline} />
                  <span>总耗时: </span>
                  <span className="tb-metrics-value">{formatDuration(lastRunMetrics.durationMs)}</span>
                </span>
              </>
            ) : null}
          </div>
        </div>

        <div className="tb-composer-toolbar">
          <div className="tb-composer-tools-left">
            {/* Hidden image file input */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/jpg,image/webp,image/gif"
              multiple
              style={{ display: "none" }}
              onChange={handleFileInputChange}
            />

            {/* Attach Image Button */}
            <button
              type="button"
              className="tb-composer-chip"
              onClick={() => fileInputRef.current?.click()}
              disabled={isStreaming}
              title="Attach images (PNG, JPEG, WebP, GIF)"
              aria-label="Attach images"
            >
              <ThemeIcon name="paperclip" size={ICON_SIZE.inline} />
            </button>

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

            {/* Permission Mode Chip.

                Deliberately *not* disabled while streaming: the daemon judges
                each tool call by the mode in force when the call is made, so a
                flip mid-run lands on the very next call — which is exactly the
                move a user wants when the agent is already working. */}
            {onSelectPermissionMode && (
              <div
                className={`tb-composer-chip tb-chip-mode${
                  permissionMode ? ` tb-chip-mode-${permissionMode}` : ""
                }`}
              >
                <ThemeIcon name="shield-check" size={ICON_SIZE.inline} />
                <NativeMenuSelect<string>
                  className="tb-composer-native-select"
                  value={permissionMode}
                  options={permissionModeOptions}
                  onChange={(next) => onSelectPermissionMode(next as ThunderPermissionMode)}
                  ariaLabel="Permission Mode"
                  emptyLabel="Mode: …"
                  title={
                    permissionMode
                      ? `${PERMISSION_MODE_HINTS[permissionMode]} — Shift+Tab cycles`
                      : "Mode not known yet — Shift+Tab cycles"
                  }
                  testId="chat-composer-mode"
                />
              </div>
            )}

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
            {showWorkspacePicker ? <button
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
            </button> : null}
          </div>

          <div className="tb-composer-tools-right">
            {isStreaming && onPauseTask && (
              <button
                type="button"
                className="tb-composer-action-btn is-pause"
                onClick={pausedTask?.taskId ? onResumeTask : onPauseTask}
                aria-label={pausedTask?.taskId ? "Resume task" : "Pause task"}
                title={
                  pausedTask?.taskId
                    ? "Resume task"
                    : "Pause at the next tool boundary"
                }
              >
                {pausedTask?.taskId ? (
                  <ThemeIcon name="play" size={ICON_SIZE.dense} />
                ) : (
                  <ThemeIcon name="pause" size={ICON_SIZE.dense} />
                )}
              </button>
            )}
            <button
              type="button"
              className={`tb-composer-action-btn${isStreaming ? " is-stop" : ""}${!isStreaming && !text.trim() && pendingImages.length === 0 ? " is-disabled" : ""}`}
              onClick={handleSendClick}
              disabled={!isStreaming && !text.trim() && pendingImages.length === 0}
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

      {imagePreview ? (
        <div
          className="notes-image-preview"
          role="dialog"
          aria-modal="true"
          onClick={() => setImagePreview(null)}
        >
          <img src={imagePreview} alt="" />
          <button
            type="button"
            className="notes-image-preview-close"
            aria-label="Close"
            onClick={() => setImagePreview(null)}
          >
            <ThemeIcon name="close" size={ICON_SIZE.default} />
          </button>
        </div>
      ) : null}
    </div>
  );
}
