import React, { useMemo, useState } from "react";
import { ICON_SIZE, ThemeIcon } from "../../../components/ThemeIcon";
import { StreamdownRenderer } from "../../../components/StreamdownRenderer";
import { desktopApi } from "../../../bridge";

export interface NoteItem {
  noteId: string;
  title: string;
  filename?: string;
  relMdPath?: string;
  contentPreview?: string;
  gtdStatus?: string;
  updatedAtMs?: number;
  createdAtMs?: number;
}

interface ArtifactNoteViewerProps {
  content: string | NoteItem[] | { title?: string; body?: string; content?: string; items?: NoteItem[] };
  title?: string;
}

export function ArtifactNoteViewer({ content, title }: ArtifactNoteViewerProps): React.JSX.Element {
  const [copied, setCopied] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedNote, setSelectedNote] = useState<{ noteId: string; title: string; body: string } | null>(null);
  const [loadingNote, setLoadingNote] = useState(false);

  // 1. Detect if content is an array of notes (Knowledge Base Catalog)
  const isListMode = useMemo(() => {
    if (selectedNote !== null) return false;
    if (Array.isArray(content)) return true;
    if (content && typeof content === "object" && Array.isArray((content as { items?: NoteItem[] }).items)) {
      return true;
    }
    return false;
  }, [content, selectedNote]);

  const noteList: NoteItem[] = useMemo(() => {
    if (Array.isArray(content)) return content;
    if (content && typeof content === "object" && Array.isArray((content as { items?: NoteItem[] }).items)) {
      return (content as { items: NoteItem[] }).items;
    }
    return [];
  }, [content]);

  const filteredNotes = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return noteList;
    return noteList.filter(
      (n) =>
        (n.title && n.title.toLowerCase().includes(q)) ||
        (n.filename && n.filename.toLowerCase().includes(q)) ||
        (n.contentPreview && n.contentPreview.toLowerCase().includes(q))
    );
  }, [noteList, query]);

  // 2. Single Document mode parsing
  const singleNoteParsed = useMemo(() => {
    if (selectedNote) return selectedNote;
    if (typeof content === "string") {
      return { noteId: "note-view", title: title || "Note", body: content };
    }
    if (content && typeof content === "object" && !Array.isArray(content) && !("items" in content)) {
      const body = (content as any).body || (content as any).content || "";
      const noteTitle = (content as any).title || title || "Note";
      return { noteId: (content as any).noteId || "note-view", title: noteTitle, body };
    }
    return { noteId: "note-view", title: title || "Note", body: "" };
  }, [content, title, selectedNote]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(singleNoteParsed.body);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };

  const handleCiteInChat = (targetTitle: string, noteId?: string) => {
    window.dispatchEvent(
      new CustomEvent("agent-resume:composer-append", {
        detail: {
          text: `@note:${targetTitle} `,
          mention: {
            kind: "note",
            id: noteId || targetTitle,
            title: targetTitle,
            badge: "Note"
          }
        }
      })
    );
  };

  const handleOpenNote = async (note: NoteItem) => {
    setLoadingNote(true);
    try {
      const res = await desktopApi().notesRead?.({ noteId: note.noteId });
      const body =
        res?.content ||
        (res as any)?.body ||
        (res as any)?.record?.content ||
        note.contentPreview ||
        "";
      setSelectedNote({
        noteId: note.noteId,
        title: note.title || note.filename || "笔记",
        body
      });
    } catch (err) {
      console.warn("Failed to read note:", err);
      setSelectedNote({
        noteId: note.noteId,
        title: note.title || note.filename || "笔记",
        body: note.contentPreview || "(Failed to load note content)"
      });
    } finally {
      setLoadingNote(false);
    }
  };

  // Render Knowledge Base Catalog / List
  if (isListMode) {
    return (
      <div className="art-notes-catalog">
        <div className="art-notes-search-bar">
          <ThemeIcon name="search" size={ICON_SIZE.dense} className="art-notes-search-icon" />
          <input
            type="search"
            className="art-notes-search-input"
            value={query}
            placeholder="搜索知识库笔记..."
            aria-label="搜索知识库笔记"
            onChange={(e) => setQuery(e.target.value)}
          />
          <span className="art-notes-count">{filteredNotes.length} 篇</span>
        </div>

        <div className="art-notes-list-body">
          {filteredNotes.length === 0 ? (
            <div className="stage-artifact-empty">
              <ThemeIcon name="notebook" size={ICON_SIZE.hero} />
              <p className="stage-artifact-empty-text">未找到匹配的笔记</p>
            </div>
          ) : (
            filteredNotes.map((note) => {
              const displayNoteTitle = note.title || note.filename || note.noteId;
              const preview = (note.contentPreview || "")
                .replace(/<!--[\s\S]*?-->/g, "")
                .replace(/^#+\s+/g, "")
                .trim();
              return (
                <div
                  key={note.noteId}
                  draggable
                  className="art-note-card"
                  onClick={() => handleOpenNote(note)}
                  onDragStart={(e) => {
                    e.dataTransfer.setData(
                      "application/x-agent-resume-note",
                      JSON.stringify({
                        noteId: note.noteId,
                        title: displayNoteTitle
                      })
                    );
                    e.dataTransfer.setData("text/plain", `@note:${displayNoteTitle} `);
                    e.dataTransfer.effectAllowed = "copy";
                  }}
                >
                  <div className="art-note-card-head">
                    <div className="art-note-card-title-box">
                      <ThemeIcon name="notebook" size={ICON_SIZE.dense} />
                      <span className="art-note-card-title">{displayNoteTitle}</span>
                    </div>
                    {note.gtdStatus ? (
                      <span className={`art-note-card-badge is-${note.gtdStatus}`}>
                        {note.gtdStatus}
                      </span>
                    ) : null}
                  </div>

                  {preview ? (
                    <div className="art-note-card-snippet">{preview}</div>
                  ) : null}

                  <div className="art-note-card-foot">
                    <span>{note.relMdPath || "library"}</span>
                    <button
                      type="button"
                      className="art-note-card-cite-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleCiteInChat(displayNoteTitle, note.noteId);
                      }}
                      title="引用进对话 (@note)"
                    >
                      <ThemeIcon name="message-square-plus" size={ICON_SIZE.inline} />
                      <span>引用</span>
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    );
  }

  // Render Single Note Document
  return (
    <div className="art-note-container">
      <div
        className="art-note-head"
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(
            "application/x-agent-resume-note",
            JSON.stringify({
              noteId: singleNoteParsed.noteId,
              title: singleNoteParsed.title
            })
          );
          e.dataTransfer.setData("text/plain", `@note:${singleNoteParsed.title} `);
          e.dataTransfer.effectAllowed = "copy";
        }}
      >
        <div className="art-note-title-box">
          {Array.isArray(content) || (content && typeof content === "object" && "items" in content) ? (
            <button
              type="button"
              className="art-note-action-btn art-note-back-btn"
              onClick={() => setSelectedNote(null)}
              title="返回笔记列表"
            >
              <ThemeIcon name="arrow-left" size={ICON_SIZE.dense} />
              <span>返回列表</span>
            </button>
          ) : (
            <ThemeIcon name="notebook" size={ICON_SIZE.default} />
          )}
          <h2 className="art-note-title">{singleNoteParsed.title}</h2>
        </div>
        <div className="art-note-head-actions">
          <button
            type="button"
            className="art-note-action-btn art-note-cite-btn"
            onClick={() => handleCiteInChat(singleNoteParsed.title, singleNoteParsed.noteId)}
            title="引用进对话 (@note)"
            aria-label="引用进对话"
          >
            <ThemeIcon name="message-square-plus" size={ICON_SIZE.dense} />
            <span className="art-note-btn-label">引用进对话</span>
          </button>
          <button
            type="button"
            className="art-note-action-btn"
            onClick={handleCopy}
            title={copied ? "Copied" : "Copy note"}
            aria-label="Copy note"
          >
            <ThemeIcon name={copied ? "check" : "copy"} size={ICON_SIZE.dense} />
          </button>
        </div>
      </div>

      <div className="art-note-content">
        {loadingNote ? (
          <div className="stage-artifact-empty">
            <ThemeIcon name="loader" size={ICON_SIZE.hero} className="spin" />
            <p className="stage-artifact-empty-text">正在加载笔记正文...</p>
          </div>
        ) : (
          <StreamdownRenderer
            content={singleNoteParsed.body || "(笔记无内容)"}
            className="art-note-markdown"
          />
        )}
      </div>
    </div>
  );
}
