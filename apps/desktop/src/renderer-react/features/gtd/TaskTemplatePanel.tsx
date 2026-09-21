import { ICON_SIZE, ThemeIcon } from "../../components/ThemeIcon";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useState } from "react";
import { desktopApi } from "../../bridge";
import { confirmDestructive } from "../../confirmAction";
import { useOverlayState } from "../../components/useOverlayMotion";
import { contextMenuPoint, showContextMenuAt } from "../../nativeContextMenu";
import { useI18n } from "../../i18n";
import { TASK_COLOR_KEYS, type TaskColorKey, type TaskCustomColor } from "../../../shared/taskColors";
import { extractImageColorCandidates } from "./imageColorCandidates";

/** One reusable GTD task template as the renderer sees it. */
export type TaskTemplate = {
  templateId: string;
  title: string;
  projectPaths: string[];
  /** Fixed-palette accent color; absent when the template has none. */
  colorKey?: TaskColorKey;
  /** Image-derived accent color (`#rrggbb`); mutually exclusive with colorKey. */
  customColor?: TaskCustomColor;
  /** Candidate colors extracted from the template image, first is recommended. */
  imageColors?: TaskCustomColor[];
  /** The persisted template image as a `data:image/png` URL; absent when none. */
  imageDataUrl?: string;
  createdAtMs: number;
  updatedAtMs: number;
};

/** The draft's image: preview plus the candidates to choose from. */
type TemplateDraftImage = {
  dataUrl: string;
  /** Base64 PNG to persist; empty when reusing the stored image unchanged. */
  pngBase64: string;
  colors: TaskCustomColor[];
};

type TemplateDraft = {
  /** Absent when creating; present when editing. */
  templateId?: string;
  title: string;
  projectPaths: string[];
  /** null keeps the template's tasks neutral. */
  colorKey: TaskColorKey | null;
  /** A picked image color; null keeps the palette choice (or none). */
  customColor: TaskCustomColor | null;
  /** Current image preview + candidates; null when the template has none. */
  image: TemplateDraftImage | null;
  /** True once the image was picked or removed in this edit; drives save semantics. */
  imageChanged: boolean;
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
 * drop target and task creation. A template may carry an image; its extracted
 * colors become selectable accents whose hue is passed through to workbench
 * windows via the task link.
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
  const [pickingImage, setPickingImage] = useState(false);

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

  const openNewTemplate = useCallback(() => {
    setDraft({
      title: "",
      projectPaths: [],
      colorKey: null,
      customColor: null,
      image: null,
      imageChanged: false,
      busy: false,
      error: ""
    });
  }, []);

  const openEditTemplate = useCallback((template: TaskTemplate) => {
    const storedImage = template.imageDataUrl && template.imageColors && template.imageColors.length > 0
      ? { dataUrl: template.imageDataUrl, pngBase64: "", colors: template.imageColors }
      : null;
    setDraft({
      templateId: template.templateId,
      title: template.title,
      projectPaths: [...template.projectPaths],
      colorKey: template.colorKey ?? null,
      customColor: template.customColor ?? null,
      image: storedImage,
      imageChanged: false,
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

  /**
   * Pick an image through the native dialog, then extract dominant colors in
   * the renderer. The recommended candidate (first) becomes the draft accent;
   * grayscale images without a usable color are rejected with a hint.
   */
  const pickImage = useCallback(async () => {
    if (!draft || draft.busy || pickingImage) return;
    const api = desktopApi();
    if (typeof api.taskTemplatesPickImage !== "function") return;
    setPickingImage(true);
    try {
      const picked = await api.taskTemplatesPickImage();
      if (!picked.ok) return;
      const dataUrl = `data:image/png;base64,${picked.pngBase64}`;
      const colors = await extractImageColorCandidates(dataUrl);
      if (colors.length === 0) {
        setDraft((current) => current
          ? { ...current, error: text("desktop.gtd.templateImageNoColors") }
          : current);
        return;
      }
      setDraft((current) => current
        ? {
            ...current,
            image: { dataUrl, pngBase64: picked.pngBase64, colors },
            imageChanged: true,
            customColor: colors[0],
            colorKey: null,
            error: ""
          }
        : current);
    } catch (error) {
      setDraft((current) => current
        ? { ...current, error: error instanceof Error ? error.message : String(error) }
        : current);
    } finally {
      setPickingImage(false);
    }
  }, [draft, pickingImage, text]);

  const removeImage = useCallback(() => {
    setDraft((current) => current
      ? { ...current, image: null, imageChanged: true, error: "" }
      : current);
  }, []);

  const selectPaletteColor = useCallback((key: TaskColorKey | null) => {
    setDraft((current) => current
      ? { ...current, colorKey: key, customColor: null }
      : current);
  }, []);

  const selectImageColor = useCallback((hex: TaskCustomColor) => {
    setDraft((current) => current
      ? { ...current, customColor: hex, colorKey: null }
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
      // Only persist image bytes when the image changed in this edit; an
      // unchanged stored image is kept, a removed one is cleared with null.
      const image = draft.imageChanged
        ? draft.image && draft.image.pngBase64
          ? { pngBase64: draft.image.pngBase64, colors: draft.image.colors }
          : null
        : undefined;
      if (draft.templateId) {
        await api.taskTemplatesUpdate({
          templateId: draft.templateId,
          title,
          projectPaths,
          colorKey: draft.colorKey,
          customColor: draft.customColor,
          ...(image !== undefined ? { image } : {})
        });
      } else {
        await api.taskTemplatesCreate({
          title,
          projectPaths,
          colorKey: draft.colorKey ?? undefined,
          customColor: draft.customColor ?? undefined,
          ...(image !== undefined && image !== null ? { image } : {})
        });
      }
      setDraft(null);
      await load();
    } catch (error) {
      setDraft((current) => current ? { ...current, busy: false, error: error instanceof Error ? error.message : String(error) } : current);
    }
  }, [draft, load, text]);

  const deleteTemplate = useCallback(async (template: TaskTemplate) => {
    if (typeof desktopApi().taskTemplatesDelete !== "function") return;
    if (!(await confirmDestructive(text("desktop.gtd.deleteTemplateConfirm", template.title), text("desktop.common.delete")))) return;
    try {
      await desktopApi().taskTemplatesDelete({ templateId: template.templateId });
      setTemplates((current) => current.filter((entry) => entry.templateId !== template.templateId));
    } catch {
      void load();
    }
  }, [text, load]);

  /**
   * Template menu. Native: it highlights with the system accent, flips at the
   * window edge, and is keyboard navigable without any code of ours.
   */
  const openTemplateMenu = useCallback(async (
    event: { clientX: number; clientY: number },
    template: TaskTemplate
  ) => {
    const choice = await showContextMenuAt(contextMenuPoint(event), [
      { id: "edit", label: text("desktop.gtd.editTemplate") },
      { type: "separator" },
      { id: "delete", label: text("desktop.gtd.deleteTemplate") }
    ]);
    if (choice === "edit") openEditTemplate(template);
    else if (choice === "delete") void deleteTemplate(template);
  }, [deleteTemplate, openEditTemplate, text]);

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
                void openTemplateMenu(event, template);
              }}
            >
              {template.imageDataUrl ? (
                <img className="gtd-template-thumb" src={template.imageDataUrl} alt="" aria-hidden="true" />
              ) : (
                <ThemeIcon name="copy" className="gtd-template-icon" size={ICON_SIZE.dense} aria-hidden="true" />
              )}
              {template.colorKey ? (
                <span
                  className="gtd-template-color"
                  data-task-accent={template.colorKey}
                  data-task-shade="1"
                  aria-hidden="true"
                />
              ) : template.customColor ? (
                <span
                  className="gtd-template-color is-custom"
                  style={{ background: template.customColor }}
                  aria-hidden="true"
                />
              ) : null}
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
            <div className="gtd-new-task-field">
              <span>{text("desktop.gtd.templateColor")}</span>
              <div className="gtd-template-color-row" role="group" aria-label={text("desktop.gtd.templateColor")}>
                <button
                  type="button"
                  className="gtd-template-swatch is-none"
                  aria-pressed={draft.colorKey == null && draft.customColor == null}
                  aria-label={text("desktop.gtd.templateColorNone")}
                  title={text("desktop.gtd.templateColorNone")}
                  onClick={() => selectPaletteColor(null)}
                />
                {TASK_COLOR_KEYS.map((key) => (
                  <button
                    type="button"
                    key={key}
                    className="gtd-template-swatch"
                    data-task-accent={key}
                    data-task-shade="1"
                    aria-pressed={draft.colorKey === key}
                    aria-label={key}
                    title={key}
                    onClick={() => selectPaletteColor(key)}
                  />
                ))}
              </div>
            </div>
            <div className="gtd-new-task-field">
              <span>{text("desktop.gtd.templateImage")}</span>
              <div className="gtd-template-image-row">
                {draft.image ? (
                  <img className="gtd-template-image-preview" src={draft.image.dataUrl} alt={text("desktop.gtd.templateImage")} />
                ) : null}
                <button
                  type="button"
                  className="wb-note-created-btn"
                  disabled={pickingImage}
                  onClick={() => void pickImage()}
                >
                  {text(draft.image ? "desktop.gtd.templateChangeImage" : "desktop.gtd.templatePickImage")}
                </button>
                {draft.image ? (
                  <button
                    type="button"
                    className="gtd-new-task-project-clear"
                    aria-label={text("desktop.gtd.templateRemoveImage")}
                    title={text("desktop.gtd.templateRemoveImage")}
                    onClick={removeImage}
                  ><ThemeIcon name="close" size={ICON_SIZE.inline} /></button>
                ) : null}
              </div>
              {draft.image && draft.image.colors.length > 0 ? (
                <div
                  className="gtd-template-color-row gtd-template-image-colors"
                  role="group"
                  aria-label={text("desktop.gtd.templateImageColors")}
                >
                  {draft.image.colors.map((hex) => (
                    <button
                      type="button"
                      key={hex}
                      className="gtd-template-swatch is-custom"
                      style={{ background: hex }}
                      aria-pressed={draft.customColor === hex}
                      aria-label={hex}
                      title={hex}
                      onClick={() => selectImageColor(hex)}
                    />
                  ))}
                </div>
              ) : null}
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
    </>
  );
}
