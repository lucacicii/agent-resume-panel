import { useCallback, useEffect, useState, type ReactNode } from "react";
import { desktopApi } from "../../bridge";
import { Sheet } from "../../components/Sheet";
import { Status, type StatusKind } from "../../components/Status";
import { renderMarkdown } from "../../components/Markdown";
import { useI18n } from "../../i18n";

type Note = Awaited<ReturnType<ReturnType<typeof desktopApi>["notesList"]>>[number];

interface NotePreviewSheetProps {
  note: Note | null;
  onClose: () => void;
}

export function NotePreviewSheet({ note, onClose }: NotePreviewSheetProps): ReactNode | null {
  const { t } = useI18n();
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<{ text: string; kind?: StatusKind }>({ text: "" });

  const load = useCallback(async (noteId: string) => {
    setLoading(true);
    setStatus({ text: "" });
    try {
      const result = await desktopApi().notesRead({ noteId });
      setContent(result.content || "");
    } catch (error) {
      setContent("");
      setStatus({ text: error instanceof Error ? error.message : String(error), kind: "error" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (note) void load(note.noteId);
    else { setContent(""); setStatus({ text: "" }); }
  }, [note, load]);

  const openInNotes = useCallback(() => {
    if (!note) return;
    window.dispatchEvent(new CustomEvent("agent-resume:tab-request", { detail: "notes" }));
    window.dispatchEvent(new CustomEvent("agent-resume:open-note", { detail: note.noteId }));
    onClose();
  }, [note, onClose]);

  if (!note) return null;

  const title = note.title || note.filename.replace(/\.md$/i, "") || note.noteId;

  return (
    <Sheet
      open
      title={title}
      onClose={onClose}
      actions={
        <button type="button" className="tool-btn" onClick={openInNotes}>
          {t("desktop.agent.openInNotes")}
        </button>
      }
    >
      <div className="muted session-preview-meta">
        {t(`desktop.kanban.scope.${note.scope}`)}
        {note.projectPath ? ` · ${note.projectPath}` : ""}
        {` · ${note.filename}`}
      </div>
      <Status kind={status.kind}>{status.text}</Status>
      {loading ? (
        <p className="muted">{t("desktop.common.loadingPreview")}</p>
      ) : content ? (
        <div className="markdown-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }} />
      ) : (
        !status.text && <p className="muted">{t("desktop.sessions.noMessages")}</p>
      )}
    </Sheet>
  );
}
