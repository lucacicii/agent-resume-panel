import React, { useMemo, useState } from "react";
import { ICON_SIZE, ThemeIcon } from "../../components/ThemeIcon";
import type { ThunderConversationSummary } from "@agent-resume/core";
import { contextMenuPoint, showContextMenuAt } from "../../nativeContextMenu";

interface ChatSidebarProps {
  conversations: ThunderConversationSummary[];
  activeSessionId: string | null;
  onSelectSession: (sessionId: string) => void;
  onNewSession: () => void;
  onDeleteSession: (sessionId: string) => void;
  onAiRenameSession: (sessionId: string) => void;
  onRenameSession: (sessionId: string, title: string) => Promise<boolean>;
  aiRenamingSessionId: string | null;
  daemonStatus: {
    available: boolean;
    models: any[];
    error?: string;
  } | null;
  onRefreshDaemon: () => void;
}

function formatRelativeTime(ms: number): string {
  const diff = Date.now() - ms;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  return new Date(ms).toLocaleDateString();
}

function groupConversations(list: ThunderConversationSummary[]) {
  const now = Date.now();
  const dayMs = 86400000;
  const groups: { label: string; items: ThunderConversationSummary[] }[] = [
    { label: "Today", items: [] },
    { label: "Yesterday", items: [] },
    { label: "Previous 7 Days", items: [] },
    { label: "Older", items: [] }
  ];

  for (const item of list) {
    const age = now - item.updated_at_ms;
    if (age < dayMs) {
      groups[0].items.push(item);
    } else if (age < 2 * dayMs) {
      groups[1].items.push(item);
    } else if (age < 7 * dayMs) {
      groups[2].items.push(item);
    } else {
      groups[3].items.push(item);
    }
  }

  return groups.filter((g) => g.items.length > 0);
}

export function ChatSidebar({
  conversations,
  activeSessionId,
  onSelectSession,
  onNewSession,
  onDeleteSession,
  onAiRenameSession,
  onRenameSession,
  aiRenamingSessionId,
  daemonStatus,
  onRefreshDaemon
}: ChatSidebarProps) {
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");

  const startEditing = (sessionId: string, currentTitle: string) => {
    setEditingId(sessionId);
    setEditingValue(currentTitle === sessionId ? "" : currentTitle);
  };

  const cancelEditing = () => {
    setEditingId(null);
    setEditingValue("");
  };

  const confirmEditing = async (sessionId: string) => {
    const trimmed = editingValue.trim();
    if (trimmed) {
      await onRenameSession(sessionId, trimmed);
    }
    cancelEditing();
  };

  const handleItemContextMenu = async (
    event: React.MouseEvent,
    item: ThunderConversationSummary
  ) => {
    event.preventDefault();
    if (editingId === item.id) return;
    const isAiRenaming = aiRenamingSessionId === item.id;
    const choice = await showContextMenuAt(contextMenuPoint(event), [
      { id: "ai-rename", label: isAiRenaming ? "AI 命名中…" : "AI 重命名（自动生成标题）", enabled: !isAiRenaming },
      { id: "rename", label: "手动重命名…" },
      { type: "separator" },
      { id: "delete", label: "删除会话" }
    ]);
    if (!choice) return;
    if (choice === "ai-rename") {
      onAiRenameSession(item.id);
    } else if (choice === "rename") {
      startEditing(item.id, item.title || item.id);
    } else if (choice === "delete") {
      onDeleteSession(item.id);
    }
  };

  const filteredConversations = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter(
      (c) =>
        (c.title && c.title.toLowerCase().includes(q)) ||
        c.id.toLowerCase().includes(q)
    );
  }, [conversations, search]);

  const groups = useMemo(
    () => groupConversations(filteredConversations),
    [filteredConversations]
  );

  return (
    <aside className="tb-chat-sidebar">
      {/* Top Action Bar */}
      <div className="tb-sidebar-header">
        <button
          type="button"
          className="tb-new-chat-btn"
          onClick={onNewSession}
          title="Start new conversation (⌘N)"
        >
          <ThemeIcon name="message-square-plus" size={ICON_SIZE.dense} />
          <span>New Chat</span>
          <kbd className="tb-sidebar-kbd">⌘N</kbd>
        </button>

        {/* Search Input */}
        <div className="tb-sidebar-search">
          <ThemeIcon name="search" size={ICON_SIZE.inline} />
          <input
            type="text"
            className="tb-sidebar-search-input"
            placeholder="Search conversations..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button
              type="button"
              className="tb-search-clear-btn"
              onClick={() => setSearch("")}
              aria-label="Clear search"
            >
              <ThemeIcon name="close" size={ICON_SIZE.inline} />
            </button>
          )}
        </div>
      </div>

      {/* Conversation Groups List */}
      <div className="tb-sidebar-list">
        {groups.length === 0 ? (
          <div className="tb-sidebar-empty">
            <span>No conversations found</span>
          </div>
        ) : (
          groups.map((group) => (
            <div key={group.label} className="tb-sidebar-group">
              <div className="tb-sidebar-group-title">{group.label}</div>
              <div className="tb-sidebar-group-items">
                {group.items.map((item) => {
                  const isActive = item.id === activeSessionId;
                  const title = item.title || item.id;
                  const isEditing = editingId === item.id;
                  const isAiRenaming = aiRenamingSessionId === item.id;
                  return (
                    <div
                      key={item.id}
                      className={`tb-sidebar-item${isActive ? " is-active" : ""}`}
                      onClick={() => {
                        if (!isEditing) onSelectSession(item.id);
                      }}
                      onContextMenu={(e) => void handleItemContextMenu(e, item)}
                    >
                      <div className="tb-sidebar-item-content">
                        {isEditing ? (
                          <input
                            type="text"
                            className="tb-sidebar-rename-input"
                            value={editingValue}
                            autoFocus
                            placeholder="输入新标题"
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => setEditingValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                void confirmEditing(item.id);
                              } else if (e.key === "Escape") {
                                e.preventDefault();
                                cancelEditing();
                              }
                            }}
                          />
                        ) : (
                          <>
                            <div className="tb-sidebar-item-title" title={title}>
                              {isAiRenaming ? `${title}（AI 命名中…）` : title}
                            </div>
                            <div className="tb-sidebar-item-meta">
                              <span>{formatRelativeTime(item.updated_at_ms)}</span>
                              {item.message_count > 0 && (
                                <span> • {item.message_count} msgs</span>
                              )}
                            </div>
                          </>
                        )}
                      </div>

                      {isEditing ? (
                        <>
                          <button
                            type="button"
                            className="tb-sidebar-item-action"
                            onClick={(e) => {
                              e.stopPropagation();
                              void confirmEditing(item.id);
                            }}
                            title="保存标题"
                            aria-label="保存标题"
                          >
                            <ThemeIcon name="check" size={ICON_SIZE.inline} />
                          </button>
                          <button
                            type="button"
                            className="tb-sidebar-item-action"
                            onClick={(e) => {
                              e.stopPropagation();
                              cancelEditing();
                            }}
                            title="取消"
                            aria-label="取消"
                          >
                            <ThemeIcon name="close" size={ICON_SIZE.inline} />
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="tb-sidebar-item-delete"
                          onClick={(e) => {
                            e.stopPropagation();
                            onDeleteSession(item.id);
                          }}
                          title="Delete conversation"
                          aria-label="Delete conversation"
                        >
                          <ThemeIcon name="trash" size={ICON_SIZE.inline} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Footer Daemon Status */}
      <div className="tb-sidebar-footer">
        <button
          type="button"
          className="tb-daemon-status-btn"
          onClick={onRefreshDaemon}
          title="Click to refresh Thunder Daemon status"
        >
          <span
            className={`tb-status-dot${daemonStatus?.available ? " online" : " offline"}`}
          />
          <div className="tb-daemon-status-info">
            <span className="tb-daemon-name">Thunder Daemon</span>
            <span className="tb-daemon-detail">
              {daemonStatus?.available
                ? `${daemonStatus.models?.length || 0} models ready`
                : "Offline / Fallback"}
            </span>
          </div>
        </button>
      </div>
    </aside>
  );
}
