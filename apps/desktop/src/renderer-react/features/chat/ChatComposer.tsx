import React, { useRef, useState, useEffect, useMemo } from "react";
import { ICON_SIZE, ThemeIcon } from "../../components/ThemeIcon";
import { NativeMenuSelect } from "../../components/NativeMenuSelect";
import { desktopApi } from "../../bridge";
import type { ThunderModelInfo } from "@agent-resume/core";

interface ChatComposerProps {
  onSend: (prompt: string, options?: { workspaceDir?: string; model?: string }) => void;
  onCancel: () => void;
  isStreaming: boolean;
  models: ThunderModelInfo[];
  selectedModel: string;
  onSelectModel: (model: string) => void;
  workspaceDir: string;
  onSelectWorkspaceDir: (dir: string) => void;
  useMock: boolean;
  onToggleMock: (mock: boolean) => void;
  placeholder?: string;
}

export function ChatComposer({
  onSend,
  onCancel,
  isStreaming,
  models,
  selectedModel,
  onSelectModel,
  workspaceDir,
  onSelectWorkspaceDir,
  useMock,
  onToggleMock,
  placeholder = "Ask Thunder agent anything, or type @ to reference context..."
}: ChatComposerProps) {
  const [text, setText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

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
        onSend(text, { workspaceDir, model: selectedModel });
        setText("");
      }
    }
  };

  const handleSendClick = () => {
    if (isStreaming) {
      onCancel();
    } else if (text.trim()) {
      onSend(text, { workspaceDir, model: selectedModel });
      setText("");
    }
  };

  const handlePickDirectory = async () => {
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

            {/* Workspace Directory Chip */}
            <button
              type="button"
              className="tb-composer-chip tb-chip-button"
              onClick={handlePickDirectory}
              disabled={isStreaming}
              title={workspaceDir || "Click to select execution folder"}
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
