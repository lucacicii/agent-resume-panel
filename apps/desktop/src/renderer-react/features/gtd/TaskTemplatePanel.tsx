import { ICON_SIZE, ThemeIcon } from "../../components/ThemeIcon";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useState } from "react";
import { desktopApi } from "../../bridge";
import { useOverlayState } from "../../components/useOverlayMotion";
import { useI18n } from "../../i18n";

/** One reusable GTD task template as the renderer sees it. */
export type TaskTemplate = {
  templateId: string;
  title: string;
  projectPaths: string[];
  createdAtMs: number;
  updatedAtMs: number;
};

type TemplateDraft = {
  /** Absent when creating; present when editing. */
  templateId?: string;
  title: string;
  projectPaths: string[];
  busy: boolean;
  error: string;
};

function projectLabel(projectPath: string): string {
  return projectPath.replaceAll("\\", "/").split("/").filter(Boolean).at(-1) || projectPath;
}

/**
 * The GTD template library at the far left of the board.
 *
 * Templates are dragged onto a column to create a pre-filled task, so the
 * panel owns create/edit/delete plus the drag payload, while `GtdView` owns the
 * drop target and task creation.
 */
export function TaskTemplatePanel({
  active,
  onDragTemplateChange
}: {
  active: boolean;
  onDragTemplateChange: (template: TaskTemplate | null) => void;
}): React.JSX.Element | null {
  const { ready, t } = useI18n();
  const [templates, setTemplates] = useState<TaskTemplate[]>([]);
  const [draft, setDraft, draftClosing] = useOverlayState<TemplateDraft>();
  const [contextMenu, setContextMenu, contextMenuClosing] = useOverlayState<{ x: number; y: number; template: TaskTemplate }>();

  const text = useCallback(
    (key: string, ...args: Array<string | number>) => (ready ? t(key, ...args) : key),
    [ready, t]
  );

  const load = useCallback(async () => {
    if (typeof desktopApi().taskTemplatesList !== "function") return;
    try {
      setTemplates(await desktopApi().taskTemplatesList());
    } catch {
      /* the library is best-effort; the board stays usable without it */
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    void load();
  }, [active, load]);

  useEffect(() => {
    const onMutated = () => { if (active) void load(); };
    window.addEventListener("agent-resume:notes-mutated", onMutated);
    return () => window.removeEventListener("agent-resume:notes-mutated", onMutated);
  }, [active, load]);

  useEffect(() => {
    if (!contextMenu) return;
    const dismiss = (event: MouseEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest(".wb-context-menu")) setContextMenu(null);
    };
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") setContextMenu(null); };
    window.addEventListener("mousedown", dismiss);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", dismiss);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [contextMenu]);

  const openNewTemplate = useCallback(() => {
    setContextMenu(null);
    setDraft({ title: "", projectPaths: [], busy: false, error: "" });
  }, []);

  const openEditTemplate = useCallback((template: TaskTemplate) => {
    setContextMenu(null);
    setDraft({
      templateId: template.templateId,
      title: template.title,
      projectPaths: [...template.projectPaths],
      busy: false,
      error: ""
    });
  }, []);

  const pickProject = useCallback(async () => {
    if (!draft || draft.busy || typeof desktopApi().pickDirectory !== "function") return;
    try {
      const result = await desktopApi().pickDirectory({ title: text("desktop.gtd.templateProject") });
      if (!result.ok) return;
      setDraft((current) => current && !current.projectPaths.includes(result.path)
        ? { ...current, projectPaths: [...current.projectPaths, result.path], error: "" }
        : current);
    } catch (error) {
      setDraft((current) => current ? { ...current, error: error instanceof Error ? error.message : String(error) } : current);
    }
  }, [draft, text]);

  const removeProject = useCallback((projectPath: string) => {
    setDraft((current) => current
      ? { ...current, projectPaths: current.projectPaths.filter((entry) => entry !== projectPath) }
      : current);
  }, []);

  const saveTemplate = useCallback(async () => {
    if (!draft || draft.busy) return;
    const title = draft.title.trim();
    if (!title) {
      setDraft((current) => current ? { ...current, error: text("desktop.gtd.taskTitleRequired") } : current);
      return;
    }
    const api = desktopApi();
    if (typeof api.taskTemplatesCreate !== "function") return;
    setDraft((current) => current ? { ...current, busy: true, error: "" } : current);
    try {
      const projectPaths = draft.projectPaths.map((entry) => entry.trim()).filter(Boolean);
      if (draft.templateId) {
        await api.taskTemplatesUpdate({ templateId: draft.templateId, title, projectPaths });
      } else {
        await api.taskTemplatesCreate({ title, projectPaths });
      }
      setDraft(null);
      await load();
    } catch (error) {
      setDraft((current) => current ? { ...current, busy: false, error: error instanceof Error ? error.message : String(error) } : current);
    }
  }, [draft, load, text]);

  const deleteTemplate = useCallback(async (template: TaskTemplate) => {
    setContextMenu(null);
    if (typeof desktopApi().taskTemplatesDelete !== "function") return;
    if (!window.confirm(text("desktop.gtd.deleteTemplateConfirm", template.title))) return;
    try {
      await desktopApi().taskTemplatesDelete({ templateId: template.templateId });
      setTemplates((current) => current.filter((entry) => entry.templateId !== template.templateId));
    } catch {
      void load();
    }
  }, [text, load]);

  if (!active) return null;

  const host = document.getElementById("react-gtd");

  return (
    <>
      <aside className="gtd-template-panel" aria-label={text("desktop.gtd.templates")}>
        <div className="gtd-template-head">
          <span className="gtd-template-head-title">
            <ThemeIcon name="layout-dashboard" size={ICON_SIZE.dense} aria-hidden="true" />
            {text("desktop.gtd.templates")}
          </span>
          <button
            type="button"
            className="gtd-template-add"
            aria-label={text("desktop.gtd.newTemplate")}
            title={text("desktop.gtd.newTemplate")}
            onClick={openNewTemplate}
          >
            <ThemeIcon name="plus" size={ICON_SIZE.dense} aria-hidden="true" />
          </button>
        </div>
        <div className="gtd-template-list">
          {templates.length === 0 ? (
            <p className="gtd-template-empty">{text("desktop.gtd.emptyTemplates")}</p>
          ) : templates.map((template) => (
            <div
              key={template.templateId}
              className="gtd-template-item"
              draggable
              title={template.title}
              onDragStart={(event) => {
                event.dataTransfer.setData("application/x-arp-task-template", template.templateId);
                event.dataTransfer.effectAllowed = "copy";
                onDragTemplateChange(template);
              }}
              onDragEnd={() => onDragTemplateChange(null)}
              onContextMenu={(event) => {
                event.preventDefault();
                setContextMenu({ x: event.clientX, y: event.clientY, template });
              }}
            >
              <ThemeIcon name="grip-vertical" className="gtd-template-grip" size={ICON_SIZE.dense} aria-hidden="true" />
              <span className="gtd-template-body">
                <span className="gtd-template-title">{template.title}</span>
                {template.projectPaths.length > 0 ? (
                  <span className="gtd-template-project" title={template.projectPaths.join("\n")}>
                    <ThemeIcon name="folder" size={ICON_SIZE.inline} aria-hidden="true" />
                    {projectLabel(template.projectPaths[0])}
                    {template.projectPaths.length > 1 ? ` +${template.projectPaths.length - 1}` : ""}
                  </span>
                ) : null}
              </span>
            </div>
          ))}
        </div>
      </aside>
      {draft && host ? createPortal(
        <div className={`wb-note-created-overlay${draftClosing ? " is-closing" : ""}`}>
          <div className="wb-note-created-backdrop" onClick={() => { if (!draft.busy) setDraft(null); }} />
          <form
            className="wb-note-created-panel gtd-new-task-panel"
            role="dialog"
            aria-modal="true"
            aria-label={draft.templateId ? text("desktop.gtd.editTemplate") : text("desktop.gtd.newTemplate")}
            onSubmit={(event) => { event.preventDefault(); void saveTemplate(); }}
          >
            <p className="wb-note-created-title">
              {draft.templateId ? text("desktop.gtd.editTemplate") : text("desktop.gtd.newTemplate")}
            </p>
            <label className="gtd-new-task-field">
              <span>{text("desktop.gtd.templateTitle")}</span>
              <input
                className="wb-rename-input"
                autoFocus
                value={draft.title}
                aria-label={text("desktop.gtd.templateTitle")}
                onChange={(event) => setDraft((current) => current ? { ...current, title: event.target.value, error: "" } : current)}
              />
            </label>
            <div className="gtd-new-task-field">
              <span>{text("desktop.gtd.templateProject")}</span>
              <div className="gtd-new-task-project">
                <button type="button" className="wb-note-created-btn" onClick={() => void pickProject()}>
                  {text("desktop.gtd.chooseProject")}
                </button>
                {draft.projectPaths.map((projectPath) => (
                  <span key={projectPath} className="gtd-new-task-project-path" title={projectPath}>
                    {projectLabel(projectPath)}
                    <button
                      type="button"
                      className="gtd-new-task-project-clear"
                      aria-label={text("desktop.common.close")}
                      onClick={() => removeProject(projectPath)}
                    ><ThemeIcon name="close" size={ICON_SIZE.inline} /></button>
                  </span>
                ))}
              </div>
            </div>
            {draft.error ? <p className="gtd-new-task-error" role="alert">{draft.error}</p> : null}
            <div className="wb-note-created-actions">
              <button type="button" className="wb-note-created-btn" disabled={draft.busy} onClick={() => setDraft(null)}>
                {text("desktop.common.cancel")}
              </button>
              <button type="submit" className="wb-note-created-btn primary" disabled={draft.busy}>
                {draft.templateId ? text("desktop.common.save") : text("desktop.gtd.createTemplate")}
              </button>
            </div>
          </form>
        </div>,
        host
      ) : null}
      {contextMenu && host ? createPortal(
        <div
          className={`wb-context-menu${contextMenuClosing ? " is-closing" : ""}`}
          role="menu"
          style={{
            left: Math.max(8, Math.min(contextMenu.x, window.innerWidth - 220)),
            top: Math.max(8, Math.min(contextMenu.y, window.innerHeight - 120))
          }}
          onContextMenu={(event) => event.preventDefault()}
        >
          <button type="button" role="menuitem" onClick={() => openEditTemplate(contextMenu.template)}>
            {text("desktop.gtd.editTemplate")}
          </button>
          <div className="context-menu-separator" role="separator" />
          <button
            type="button"
            role="menuitem"
            className="context-menu-item-danger"
            onClick={() => void deleteTemplate(contextMenu.template)}
          >
            {text("desktop.gtd.deleteTemplate")}
          </button>
        </div>,
        host
      ) : null}
    </>
  );
}
