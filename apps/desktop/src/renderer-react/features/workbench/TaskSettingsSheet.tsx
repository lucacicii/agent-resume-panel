import { ICON_SIZE, ThemeIcon } from "../../components/ThemeIcon";
import { Sheet } from "../../components/Sheet";
import { ToggleRow } from "../../components/SettingRows";
import { useI18n } from "../../i18n";
import type { TaskWorktreeRepo } from "../../../shared/worktreeTypes";
import { basename } from "./git/workbenchGitModel";
import type { TaskWorktrees } from "./git/useTaskWorktrees";

/**
 * Everything that belongs to one workbench rather than to the whole panel.
 *
 * Folders live here — the task card keeps its `+` shortcut, because referencing
 * a repository is a step you take constantly while setting a task up — and so
 * does the worktree switch, which governs the convention handed to agents rather
 * than what the panel is allowed to show: checkouts that exist on disk are
 * listed here whether or not the switch is on, since hiding real work behind a
 * boolean reads as a broken feature.
 */
export function TaskSettingsSheet({
  open,
  onClose,
  title,
  statusColumn,
  statusLabel,
  projects,
  aliases,
  worktrees,
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
  worktrees: TaskWorktrees;
  onAddProject: () => void;
  onRemoveProject: (projectPath: string) => void;
  onRevealPath: (targetPath: string) => void;
}): React.JSX.Element {
  const { t } = useI18n();
  // Repositories with nothing to show are left out, except the ones that cannot
  // have worktrees at all: those are exactly what a person needs told.
  const repos = (worktrees.listing?.repos ?? []).filter((repo) => repo.worktrees.length || !repo.exists || !repo.isGitRepo);
  const checkouts = (worktrees.listing?.repos ?? []).flatMap((repo) => repo.worktrees.filter((worktree) => !worktree.isMain));
  /** Only the ones that are really there count as work left to clean up. */
  const present = checkouts.filter((worktree) => !worktree.missing).length;

  const stateChip = (worktree: TaskWorktreeRepo["worktrees"][number]) => {
    if (worktree.missing || worktree.prunable) return <span className="wb-worktree-state is-missing">{t("desktop.workbench.worktreeStateMissing")}</span>;
    if (worktree.isMain) return <span className="wb-worktree-state">{t("desktop.workbench.worktreeMainCheckout")}</span>;
    if (worktree.locked) return <span className="wb-worktree-state is-warning" title={worktree.lockedReason}>{t("desktop.workbench.worktreeStateLocked")}</span>;
    // Anything else still holds work, which is not a state worth a chip.
    return worktree.merged ? <span className="wb-worktree-state is-ok">{t("desktop.workbench.worktreeStateMerged")}</span> : null;
  };

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
      <section className="settings-group">
        <h3 className="settings-group-title">{t("desktop.workbench.worktreeSection")}</h3>
        <div className="settings-group-body">
          <ToggleRow
            title={t("desktop.workbench.worktreeEnable")}
            description={t("desktop.workbench.worktreeEnableHint")}
            checked={worktrees.state.enabled}
            onChange={(checked) => void worktrees.saveState({ enabled: checked })}
          />
          <div className="settings-row">
            <span className="settings-row-label"><span className="settings-row-title">{t("desktop.workbench.worktreeRoot")}</span></span>
            <span className="wb-task-settings-path is-root" title={worktrees.root}>{worktrees.root || "-"}</span>
          </div>
          {present ? (
            <p className="settings-callout wb-worktree-reminder" role="status">
              <ThemeIcon name="message-square-warning" size={ICON_SIZE.inline} aria-hidden="true" />
              {t("desktop.workbench.worktreeReminder", String(present))}
            </p>
          ) : null}
          <div className="wb-worktree-settings-list" role="list">
            {repos.map((repo) => (
              <div className="wb-worktree-settings-repo" role="listitem" key={repo.repoRoot}>
                <p className="wb-worktree-settings-repo-head">
                  <span className="wb-task-settings-name">{repo.label}</span>
                  <span className="wb-task-settings-path" title={repo.repoRoot}>{repo.repoRoot}</span>
                </p>
                {!repo.exists
                  ? <p className="muted wb-task-settings-empty">{t("desktop.workbench.worktreeFolderMissing")}</p>
                  : !repo.isGitRepo
                    ? <p className="muted wb-task-settings-empty">{t("desktop.workbench.worktreeNotGitRepo")}</p>
                    : repo.worktrees.map((worktree) => (
                      <div className="wb-worktree-settings-row" role="listitem" key={worktree.path}>
                        <ThemeIcon name="git-branch" size={ICON_SIZE.dense} aria-hidden="true" />
                        <span className="wb-worktree-settings-branch">
                          {worktree.branch || (worktree.detached ? t("desktop.workbench.worktreeDetached") : "-")}
                        </span>
                        {stateChip(worktree)}
                        <span className="wb-task-settings-path" title={worktree.path}>{basename(worktree.path)}</span>
                        <button
                          type="button"
                          className="wb-icon-btn"
                          disabled={worktree.missing}
                          aria-label={t("desktop.common.revealInFinder")}
                          title={worktree.path}
                          onClick={() => onRevealPath(worktree.path)}
                        ><ThemeIcon name="folder-open" size={ICON_SIZE.dense} aria-hidden="true" /></button>
                      </div>
                    ))}
              </div>
            ))}
            {!checkouts.length ? <p className="muted wb-task-settings-empty">{t("desktop.workbench.worktreeListEmpty")}</p> : null}
          </div>
        </div>
      </section>
    </Sheet>
  );
}
