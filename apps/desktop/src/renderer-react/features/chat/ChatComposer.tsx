import React, { useRef, useState, useEffect, useMemo, useCallback } from "react";
import { ICON_SIZE, ThemeIcon } from "../../components/ThemeIcon";
import { NativeMenuSelect } from "../../components/NativeMenuSelect";
import { showContextMenuAt, type NativeContextMenuItem } from "../../nativeContextMenu";
import { desktopApi } from "../../bridge";
import type { ThunderModelInfo } from "@agent-resume/core";

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
  placeholder = "Ask Thunder agent anything, or type @ to reference context...",
  prefillPrompt
}: ChatComposerProps) {
  const [text, setText] = useState("");
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const workspaceButtonRef = useRef<HTMLButtonElement | null>(null);

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

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (isStreaming) {
        return;
      }
      if (text.trim()) {
        onSend(text, { workspaceDir, model: selectedModel, thinking_level: thinkingLevel });
        setText("");
      }
    }
  };

  const handleSendClick = () => {
    if (isStreaming) {
      onCancel();
    } else if (text.trim()) {
      onSend(text, { workspaceDir, model: selectedModel, thinking_level: thinkingLevel });
      setText("");
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

  return (
    <div className="tb-composer-wrapper">
      <div className={`tb-composer-box${isStreaming ? " is-active" : ""}`}>
        <div className="tb-composer-input-area">
          <textarea
            ref={textareaRef}
            className="tb-composer-textarea"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            rows={1}
          />
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
