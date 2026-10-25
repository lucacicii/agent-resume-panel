import { ICON_SIZE, ThemeIcon } from "../../components/ThemeIcon";
import { Sheet } from "../../components/Sheet";
import { useI18n } from "../../i18n";
import { basename } from "./git/workbenchGitModel";

/**
 * Everything that belongs to one workbench rather than to the whole panel.
 *
 * Folders live here — the task card keeps its `+` shortcut, because referencing
 * a repository is a step you take constantly while setting a task up.
 */
export function TaskSettingsSheet({
  open,
  onClose,
  title,
  statusColumn,
  statusLabel,
  projects,
  aliases,
  onAddProject,
  onRemoveProject,
  onRevealPath
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  /** The task's workflow column, for the chip's colour. */
  statusColumn: string;
  /** That column's localized name. */
  statusLabel: string;
  projects: string[];
  aliases: Record<string, string>;
  onAddProject: () => void;
  onRemoveProject: (projectPath: string) => void;
  onRevealPath: (targetPath: string) => void;
}): React.JSX.Element {
  const { t } = useI18n();

  return (
    <Sheet open={open} onClose={onClose} title={t("desktop.workbench.taskSettings")} modal wide>
      <p className="wb-task-settings-head">
        <span className="wb-task-settings-title">{title}</span>
        <span className={`wb-task-status is-${statusColumn}`}>{statusLabel}</span>
      </p>
      <section className="settings-group">
        <h3 className="settings-group-title">{t("desktop.workbench.taskSettingsFolders")}</h3>
        <div className="settings-group-body">
          <div className="wb-task-settings-list" role="list">
            {projects.map((path) => (
              <div className="wb-task-settings-row" role="listitem" key={path}>
                <ThemeIcon name="folder-tree" size={ICON_SIZE.dense} aria-hidden="true" />
                <span className="wb-task-settings-name">{aliases[path] || basename(path)}</span>
                <span className="wb-task-settings-path" title={path}>{path}</span>
                <button
                  type="button"
                  className="wb-icon-btn"
                  aria-label={t("desktop.common.revealInFinder")}
                  title={t("desktop.common.revealInFinder")}
                  onClick={() => onRevealPath(path)}
                ><ThemeIcon name="folder-open" size={ICON_SIZE.dense} aria-hidden="true" /></button>
                <button
                  type="button"
                  className="wb-icon-btn"
                  aria-label={t("desktop.workbench.removeProject")}
                  title={t("desktop.workbench.removeProject")}
                  onClick={() => onRemoveProject(path)}
                ><ThemeIcon name="close" size={ICON_SIZE.dense} aria-hidden="true" /></button>
              </div>
            ))}
            {!projects.length ? <p className="muted wb-task-settings-empty">{t("desktop.workbench.taskNoProject")}</p> : null}
          </div>
          <div className="settings-action-row">
            <button type="button" className="tool-btn" onClick={onAddProject}>
              <ThemeIcon name="plus" size={ICON_SIZE.dense} aria-hidden="true" />
              {t("desktop.workbench.addProject")}
            </button>
          </div>
        </div>
      </section>
    </Sheet>
  );
}
