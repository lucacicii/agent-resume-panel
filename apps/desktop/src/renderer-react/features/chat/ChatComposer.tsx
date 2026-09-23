import React, { useRef, useState, useEffect, useMemo } from "react";
import { ICON_SIZE, ThemeIcon } from "../../components/ThemeIcon";
import { NativeMenuSelect } from "../../components/NativeMenuSelect";
import { desktopApi } from "../../bridge";
import type { ThunderModelInfo } from "@agent-resume/core";

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
  workspaceLocked = false,
  useMock,
  onToggleMock,
  placeholder = "Ask Thunder agent anything, or type @ to reference context...",
  prefillPrompt
}: ChatComposerProps) {
  const [text, setText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

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

  const handlePickDirectory = async () => {
    if (workspaceLocked) return;
    try {
      const picked = await desktopApi().pickDirectory();
      if (picked && picked.ok) {
        localStorage.setItem("chat-selected-workspace", picked.path);
        onSelectWorkspaceDir(picked.path);
      }
    } catch (err) {
      console.warn("Failed to pick directory:", err);
    }
  };

  const workspaceName = workspaceDir
    ? workspaceDir.split("/").filter(Boolean).pop() || workspaceDir
    : "Current Workspace";

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

            {/* Workspace Directory Chip */}
            <button
              type="button"
              className={`tb-composer-chip${workspaceLocked ? " tb-chip-locked" : " tb-chip-button"}`}
              onClick={handlePickDirectory}
              disabled={isStreaming || workspaceLocked}
              title={
                workspaceLocked
                  ? `${workspaceDir} (Workspace is bound to this conversation and cannot be changed)`
                  : (workspaceDir || "Click to select execution folder")
              }
            >
              <ThemeIcon name="folder" size={ICON_SIZE.inline} />
              <span className="tb-chip-label">{workspaceName}</span>
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
