import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ChevronRight, Play, RefreshCw, TerminalSquare } from "lucide-react";
import { useI18n } from "../../i18n";

export type ScriptKind = "npm" | "pnpm" | "yarn" | "bun" | "make" | "gradle" | "python" | "cargo";

export type ScriptEntryView = {
  id: string;
  name: string;
  detail?: string;
  run: { cwd: string; command: string };
};

export type ScriptPackageView = {
  id: string;
  kind: ScriptKind;
  packageRoot: string;
  relativeRoot: string;
  label: string;
  manifestPath: string;
  managerHint?: string;
  scripts: ScriptEntryView[];
};

export type ScriptsTreeProps = {
  packages: ScriptPackageView[];
  loading?: boolean;
  error?: string | null;
  truncated?: boolean;
  emptyHint?: string;
  noRootHint?: string;
  hasProject: boolean;
  compact?: boolean;
  onRefresh?: () => void;
  onRun: (script: ScriptEntryView, pkg: ScriptPackageView) => void;
};

type PathGroup = {
  key: string;
  label: string;
  relativeRoot: string;
  packages: ScriptPackageView[];
};

function kindLabelKey(kind: ScriptKind): string {
  return `desktop.workbench.scriptsKind.${kind}`;
}

function groupByPath(packages: ScriptPackageView[]): PathGroup[] {
  const map = new Map<string, PathGroup>();
  for (const pkg of packages) {
    const key = pkg.relativeRoot || ".";
    let group = map.get(key);
    if (!group) {
      group = {
        key,
        label: pkg.label,
        relativeRoot: pkg.relativeRoot,
        packages: []
      };
      map.set(key, group);
    }
    group.packages.push(pkg);
  }
  return [...map.values()];
}

function defaultExpanded(groups: PathGroup[]): Set<string> {
  const next = new Set<string>();
  if (groups.length === 1) {
    next.add(groups[0].key);
    for (const pkg of groups[0].packages) next.add(pkg.id);
    return next;
  }
  for (const group of groups) {
    if (group.relativeRoot === ".") {
      next.add(group.key);
      for (const pkg of group.packages) next.add(pkg.id);
    }
  }
  return next;
}

export function ScriptsTree({
  packages,
  loading,
  error,
  truncated,
  emptyHint,
  noRootHint,
  hasProject,
  compact,
  onRefresh,
  onRun
}: ScriptsTreeProps): React.JSX.Element {
  const { t } = useI18n();
  const groups = useMemo(() => groupByPath(packages), [packages]);
  const packagesKey = useMemo(() => packages.map((p) => p.id).join("|"), [packages]);
  const [expanded, setExpanded] = useState<Set<string>>(() => defaultExpanded(groups));
  useEffect(() => {
    setExpanded(defaultExpanded(groupByPath(packages)));
  }, [packagesKey]); // eslint-disable-line react-hooks/exhaustive-deps -- reset expand only when package set identity changes

  const toggle = (id: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  let body: ReactNode;
  if (!hasProject) {
    body = <p className="muted wb-file-tree-empty">{noRootHint}</p>;
  } else if (loading) {
    body = (
      <p className="muted wb-scripts-status" role="status">
        {t("desktop.common.loading")}
      </p>
    );
  } else if (error) {
    body = (
      <p className="muted wb-scripts-status is-error" role="alert">
        {error}
      </p>
    );
  } else if (!packages.length) {
    body = <p className="muted wb-file-tree-empty">{emptyHint}</p>;
  } else {
    body = (
      <div className="wb-scripts-tree" role="tree">
        {groups.map((group) => {
          const groupOpen = expanded.has(group.key);
          const multiKind = group.packages.length > 1;
          return (
            <div key={group.key} className="wb-scripts-group" role="treeitem" aria-expanded={groupOpen}>
              <button
                type="button"
                className="wb-file-tree-row wb-scripts-group-row"
                style={{ paddingLeft: "8px" }}
                onClick={() => toggle(group.key)}
              >
                <span className={`wb-file-tree-chevron${groupOpen ? " is-expanded" : ""}`}>
                  <ChevronRight size={12} />
                </span>
                <TerminalSquare size={14} className="wb-file-tree-icon" />
                <span className="wb-file-tree-label" title={group.relativeRoot}>
                  {group.label}
                </span>
                {!multiKind ? (
                  <span className="wb-scripts-kind-badge">
                    {t(kindLabelKey(group.packages[0].kind))}
                  </span>
                ) : (
                  <span className="wb-scripts-kind-badge">
                    {group.packages.length}
                  </span>
                )}
              </button>
              {groupOpen
                ? group.packages.map((pkg) => {
                    const pkgOpen = expanded.has(pkg.id);
                    const showKindRow = multiKind;
                    if (showKindRow) {
                      return (
                        <div key={pkg.id} role="group">
                          <button
                            type="button"
                            className="wb-file-tree-row wb-scripts-package-row"
                            style={{ paddingLeft: `${8 + 14}px` }}
                            onClick={() => toggle(pkg.id)}
                          >
                            <span className={`wb-file-tree-chevron${pkgOpen ? " is-expanded" : ""}`}>
                              <ChevronRight size={12} />
                            </span>
                            <span className="wb-scripts-kind-badge is-inline">
                              {t(kindLabelKey(pkg.kind))}
                            </span>
                            <span className="wb-file-tree-label muted">
                              {pkg.scripts.length}
                            </span>
                          </button>
                          {pkgOpen
                            ? pkg.scripts.map((script) => (
                                <button
                                  type="button"
                                  key={script.id}
                                  className="wb-file-tree-row wb-scripts-script-row"
                                  style={{ paddingLeft: `${8 + 28}px` }}
                                  title={script.detail ? `${script.run.command}\n${script.detail}` : script.run.command}
                                  onClick={() => onRun(script, pkg)}
                                  onDoubleClick={() => onRun(script, pkg)}
                                >
                                  <span className="wb-file-tree-chevron is-placeholder" aria-hidden="true" />
                                  <Play size={12} className="wb-file-tree-icon wb-scripts-play-icon" />
                                  <span className="wb-file-tree-label">{script.name}</span>
                                </button>
                              ))
                            : null}
                        </div>
                      );
                    }
                    return (
                      <div key={pkg.id} role="group">
                        {pkg.scripts.map((script) => (
                          <button
                            type="button"
                            key={script.id}
                            className="wb-file-tree-row wb-scripts-script-row"
                            style={{ paddingLeft: `${8 + 14}px` }}
                            title={script.detail ? `${script.run.command}\n${script.detail}` : script.run.command}
                            onClick={() => onRun(script, pkg)}
                            onDoubleClick={() => onRun(script, pkg)}
                          >
                            <span className="wb-file-tree-chevron is-placeholder" aria-hidden="true" />
                            <Play size={12} className="wb-file-tree-icon wb-scripts-play-icon" />
                            <span className="wb-file-tree-label">{script.name}</span>
                          </button>
                        ))}
                      </div>
                    );
                  })
                : null}
            </div>
          );
        })}
        {truncated ? (
          <p className="muted wb-scripts-truncated">{t("desktop.workbench.scriptsTruncated")}</p>
        ) : null}
      </div>
    );
  }

  return (
    <div className={`wb-scripts-pane${compact ? " is-compact" : ""}`}>
      {compact ? (
        onRefresh ? (
          <div className="wb-scripts-pane-head is-compact-head">
            <button
              type="button"
              className="wb-git-action-btn"
              disabled={loading || !hasProject}
              onClick={onRefresh}
              aria-label={t("desktop.workbench.scriptsRefresh")}
              title={t("desktop.workbench.scriptsRefresh")}
            >
              <RefreshCw size={14} className={loading ? "spin" : undefined} />
            </button>
          </div>
        ) : null
      ) : (
        <div className="wb-scripts-pane-head">
          <span className="wb-side-pane-title">{t("desktop.workbench.sidePanelScripts")}</span>
          {onRefresh ? (
            <button
              type="button"
              className="wb-git-action-btn"
              disabled={loading || !hasProject}
              onClick={onRefresh}
              aria-label={t("desktop.workbench.scriptsRefresh")}
              title={t("desktop.workbench.scriptsRefresh")}
            >
              <RefreshCw size={14} className={loading ? "spin" : undefined} />
            </button>
          ) : null}
        </div>
      )}
      {body}
    </div>
  );
}
