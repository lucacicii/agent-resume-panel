import { ThemeIcon } from "../../components/ThemeIcon";
import { useI18n } from "../../i18n";

export type WorkbenchGitChange = {
  path: string;
  repoPath: string;
  repoRoot: string;
  status: string;
  staged: boolean;
  unstaged: boolean;
};

export function WorkbenchGitChangesPane({
  hasProject,
  isRepo,
  staged,
  unstaged,
  loading,
  error,
  onOpenChange,
  onRefresh
}: {
  hasProject: boolean;
  isRepo: boolean;
  staged: WorkbenchGitChange[];
  unstaged: WorkbenchGitChange[];
  loading?: boolean;
  error?: string;
  onOpenChange: (change: WorkbenchGitChange, staged: boolean) => void;
  onRefresh?: () => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const sections = [
    { title: t("desktop.workbench.sidePanelStaged"), staged: true, entries: staged },
    { title: t("desktop.workbench.sidePanelChanges"), staged: false, entries: unstaged }
  ];
  const hasEntries = sections.some((section) => section.entries.length);

  return (
    <div className="wb-side-pane">
      <div className="wb-side-pane-head wb-git-pane-head">
        <span className="wb-side-pane-title">{t("desktop.workbench.sidePanelGit")}</span>
        {onRefresh ? (
          <div className="wb-git-actions">
            <button
              type="button"
              className="wb-git-action-btn"
              disabled={loading}
              onClick={onRefresh}
              aria-label={t("desktop.common.refresh")}
            >
              <ThemeIcon name="refresh" size={15} className={loading ? "spin" : undefined} />
            </button>
          </div>
        ) : null}
      </div>
      <div className="wb-git-panel">
        {!hasProject ? (
          <p className="muted wb-git-empty">{t("desktop.workbench.sidePanelNoRoot")}</p>
        ) : error ? (
          <p className="muted wb-git-empty is-error" role="alert">{error}</p>
        ) : loading && !isRepo && !hasEntries ? (
          <p className="muted wb-git-empty" role="status">{t("desktop.common.loading")}</p>
        ) : isRepo ? (
          <>
            {sections.map((section) => section.entries.length ? (
              <section className="wb-git-section" key={section.title}>
                <h4 className="wb-git-section-title">{section.title}</h4>
                {section.entries.map((change, index) => (
                  <button
                    type="button"
                    className="wb-git-file"
                    key={`${change.repoRoot}:${change.repoPath}:${index}`}
                    onClick={() => onOpenChange(change, section.staged)}
                  >
                    <span className={`wb-git-file-status is-${change.status.toLowerCase().slice(0, 3)}`}>{change.status}</span>
                    <span className="wb-git-file-path">{change.path}</span>
                  </button>
                ))}
              </section>
            ) : null)}
            {!hasEntries ? <p className="muted wb-git-empty">{t("desktop.workbench.sidePanelNoChanges")}</p> : null}
          </>
        ) : (
          <p className="muted wb-git-empty">{t("desktop.workbench.sidePanelGitUnavailable")}</p>
        )}
      </div>
    </div>
  );
}
