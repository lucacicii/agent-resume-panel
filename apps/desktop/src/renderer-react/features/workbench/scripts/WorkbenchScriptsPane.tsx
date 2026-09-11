import { ThemeIcon } from "../../../components/ThemeIcon";
import { useI18n } from "../../../i18n";
import { ScriptsTree, type ScriptEntryView, type ScriptPackageView } from "../ScriptsTree";

export function WorkbenchScriptsPane({
  compact,
  hasProject,
  selectedProject,
  packages,
  loading,
  error,
  truncated,
  collapsed,
  onToggleCollapsed,
  onRefresh,
  onRun
}: {
  compact?: boolean;
  hasProject: boolean;
  selectedProject: string | null;
  packages: ScriptPackageView[];
  loading: boolean;
  error: string;
  truncated: boolean;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  onRefresh?: () => void;
  onRun: (script: ScriptEntryView, pkg: ScriptPackageView) => void;
}): React.JSX.Element {
  const { t } = useI18n();
  if (compact) {
    return <div className={`wb-explorer-scripts${collapsed ? " is-collapsed" : ""}`}>
      <div className="wb-explorer-scripts-head">
        <button type="button" className="wb-explorer-scripts-toggle" aria-expanded={!collapsed} onClick={onToggleCollapsed}>
          <span className={`wb-file-tree-chevron${collapsed ? "" : " is-expanded"}`}><ThemeIcon name="chevron-right" size={12} /></span>
          <span className="wb-side-pane-title">{t("desktop.workbench.sidePanelScripts")}</span>
        </button>
        {selectedProject ? <button type="button" className="wb-git-action-btn" disabled={loading} onClick={onRefresh} aria-label={t("desktop.workbench.scriptsRefresh")} title={t("desktop.workbench.scriptsRefresh")}><ThemeIcon name="refresh" size={14} className={loading ? "spin" : undefined} /></button> : null}
      </div>
      {!collapsed ? <ScriptsTree packages={packages} loading={loading} error={error || null} truncated={truncated} hasProject={hasProject} compact emptyHint={t("desktop.workbench.scriptsEmpty")} noRootHint={t("desktop.workbench.sidePanelNoRoot")} onRun={onRun} /> : null}
    </div>;
  }
  return <div className="wb-side-pane">
    <ScriptsTree packages={packages} loading={loading} error={error || null} truncated={truncated} hasProject={hasProject} emptyHint={t("desktop.workbench.scriptsEmpty")} noRootHint={t("desktop.workbench.sidePanelNoRoot")} onRefresh={onRefresh} onRun={onRun} />
  </div>;
}
