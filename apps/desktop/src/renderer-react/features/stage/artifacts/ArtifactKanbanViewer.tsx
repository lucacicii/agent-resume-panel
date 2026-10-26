import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ICON_SIZE, ThemeIcon } from "../../../components/ThemeIcon";
import { desktopApi } from "../../../bridge";
import type { GtdStatus } from "@agent-resume/core";

export interface KanbanTaskItem {
  noteId?: string;
  id?: string;
  title: string;
  gtdStatus?: string;
  rollupStatus?: string;
  next?: string;
  decision?: string;
  roots?: string[];
  sessionCount?: number;
}

interface ArtifactKanbanViewerProps {
  tasks: KanbanTaskItem[] | { tasks?: KanbanTaskItem[] };
}

const COLUMNS: Array<{ id: string; label: string; dotColor: string }> = [
  { id: "inbox", label: "Inbox", dotColor: "var(--color-label-tertiary)" },
  { id: "next", label: "Next", dotColor: "var(--color-accent)" },
  { id: "waiting", label: "Waiting", dotColor: "var(--color-warning)" },
  { id: "someday", label: "Someday", dotColor: "var(--color-purple, #a855f7)" },
  { id: "reference", label: "Reference", dotColor: "var(--color-teal, #14b8a6)" },
  { id: "done", label: "Done", dotColor: "var(--color-success)" }
];

export function ArtifactKanbanViewer({ tasks }: ArtifactKanbanViewerProps): React.JSX.Element {
  const [localTasks, setLocalTasks] = useState<KanbanTaskItem[]>(() => {
    if (Array.isArray(tasks)) return tasks;
    if (tasks && typeof tasks === "object" && Array.isArray((tasks as { tasks?: KanbanTaskItem[] }).tasks)) {
      return (tasks as { tasks: KanbanTaskItem[] }).tasks;
    }
    return [];
  });

  const [draggedNoteId, setDraggedNoteId] = useState<string | null>(null);
  const [dropTargetCol, setDropTargetCol] = useState<string | null>(null);

  useEffect(() => {
    if (Array.isArray(tasks)) {
      setLocalTasks(tasks);
    } else if (tasks && typeof tasks === "object" && Array.isArray((tasks as { tasks?: KanbanTaskItem[] }).tasks)) {
      setLocalTasks((tasks as { tasks: KanbanTaskItem[] }).tasks);
    }
  }, [tasks]);

  const handleStatusTransition = useCallback((noteId: string, targetStatus: GtdStatus) => {
    // 0ms Optimistic local update
    setLocalTasks((prev) =>
      prev.map((t) => {
        const id = t.noteId || t.id;
        if (id === noteId) {
          return { ...t, gtdStatus: targetStatus, rollupStatus: targetStatus };
        }
        return t;
      })
    );

    // Silent background writeback to SQLite database
    void desktopApi()
      .notesSetGtdStatus?.({ noteId, status: targetStatus })
      .catch((err) => {
        console.warn("Failed to persist GTD status:", err);
      });
  }, []);

  const grouped = useMemo(() => {
    const map: Record<string, KanbanTaskItem[]> = {
      inbox: [],
      next: [],
      waiting: [],
      someday: [],
      reference: [],
      done: []
    };
    for (const t of localTasks) {
      const status = (t.rollupStatus || t.gtdStatus || "inbox").toLowerCase();
      if (status in map) {
        map[status].push(t);
      } else {
        map.inbox.push(t);
      }
    }
    return map;
  }, [localTasks]);

  return (
    <div className="art-kanban-board">
      {COLUMNS.map((col) => {
        const items = grouped[col.id] || [];
        const isTarget = dropTargetCol === col.id;
        return (
          <div
            key={col.id}
            className={`art-kanban-col${isTarget ? " is-drop-target" : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              if (dropTargetCol !== col.id) {
                setDropTargetCol(col.id);
              }
            }}
            onDragLeave={(e) => {
              if (e.currentTarget.contains(e.relatedTarget as Node)) return;
              if (dropTargetCol === col.id) {
                setDropTargetCol(null);
              }
            }}
            onDrop={(e) => {
              e.preventDefault();
              setDropTargetCol(null);
              const noteId = draggedNoteId || e.dataTransfer.getData("text/plain");
              setDraggedNoteId(null);
              if (noteId) {
                handleStatusTransition(noteId, col.id as GtdStatus);
              }
            }}
          >
            <div className="art-kanban-col-head">
              <span className="art-kanban-col-dot" style={{ backgroundColor: col.dotColor }} />
              <span className="art-kanban-col-title">{col.label}</span>
              <span className="art-kanban-col-count">{items.length}</span>
            </div>
            <div className="art-kanban-col-body">
              {items.length === 0 ? (
                <div className="art-kanban-empty-col">Empty</div>
              ) : (
                items.map((item, idx) => {
                  const id = item.noteId || item.id || `task-${idx}`;
                  const isDragging = draggedNoteId === id;
                  return (
                    <div
                      key={id}
                      draggable
                      className={`art-kanban-card${isDragging ? " is-dragging" : ""}`}
                      title={item.next ? `Next: ${item.next}` : item.title}
                      onDragStart={(e) => {
                        const noteId = item.noteId || item.id;
                        if (!noteId) return;
                        setDraggedNoteId(noteId);
                        e.dataTransfer.setData("text/plain", noteId);
                        e.dataTransfer.setData(
                          "application/x-agent-resume-task",
                          JSON.stringify(item)
                        );
                        e.dataTransfer.effectAllowed = "copyMove";
                      }}
                      onDragEnd={() => {
                        setDraggedNoteId(null);
                        setDropTargetCol(null);
                      }}
                    >
                      <div className="art-kanban-card-title">{item.title}</div>
                      {item.next ? (
                        <div className="art-kanban-card-next">
                          <ThemeIcon name="arrow-right" size={ICON_SIZE.inline} />
                          <span>{item.next}</span>
                        </div>
                      ) : null}
                      {item.decision ? (
                        <div className="art-kanban-card-decision">
                          <ThemeIcon name="target" size={ICON_SIZE.inline} />
                          <span>{item.decision}</span>
                        </div>
                      ) : null}
                      <div className="art-kanban-card-footer">
                        {item.roots && item.roots.length > 0 ? (
                          <span className="art-kanban-card-root">
                            {item.roots[0].split("/").filter(Boolean).pop() || "project"}
                          </span>
                        ) : null}
                        {typeof item.sessionCount === "number" && item.sessionCount > 0 ? (
                          <span className="art-kanban-card-sessions">
                            <ThemeIcon name="history" size={ICON_SIZE.inline} />
                            {item.sessionCount}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
