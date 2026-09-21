import { ICON_SIZE, ThemeIcon } from "../../components/ThemeIcon";
import { useEffect, useMemo, useState, type ReactNode } from "react";
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

type ScriptsTreeProps = {
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
  /**
   * Right-click anywhere in the pane: one script when a script row was hit, the
   * package's scripts on a package row, everything otherwise.
   */
  onScriptContextMenu?: (event: { clientX: number; clientY: number }, scripts: ScriptEntryView[]) => void;
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
  onRun,
  onScriptContextMenu
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

  /**
   * Which scripts a right-click targets: the row's script, the package's whole
   * set, the group's set, or everything in the pane. Right-clicking anywhere in
   * the pane must never be a dead end, since only script rows used to respond.
   */
  const scriptsAtTarget = (target: EventTarget | null): ScriptEntryView[] => {
    const element = target instanceof Element ? target : null;
    const scriptRow = element?.closest<HTMLElement>("[data-script-id]");
    const scriptId = scriptRow?.dataset.scriptId;
    if (scriptId) {
      for (const pkg of packages) {
        const found = pkg.scripts.find((script) => script.id === scriptId);
        if (found) return [found];
      }
    }
    const packageId = element?.closest<HTMLElement>("[data-package-id]")?.dataset.packageId;
    if (packageId) {
      const pkg = packages.find((entry) => entry.id === packageId);
      if (pkg?.scripts.length) return pkg.scripts;
    }
    const groupKey = element?.closest<HTMLElement>("[data-script-group]")?.dataset.scriptGroup;
    if (groupKey) {
      const group = groups.find((entry) => entry.key === groupKey);
      const scripts = group?.packages.flatMap((pkg) => pkg.scripts) ?? [];
      if (scripts.length) return scripts;
    }
    return packages.flatMap((pkg) => pkg.scripts);
  };

  const onPaneContextMenu = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!onScriptContextMenu) return;
    const scripts = scriptsAtTarget(event.target);
    if (!scripts.length) return;
    event.preventDefault();
    onScriptContextMenu(event, scripts);
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
            <div key={group.key} className="wb-scripts-group" role="treeitem" aria-expanded={groupOpen} data-script-group={group.key}>
              <button
                type="button"
                className="wb-file-tree-row wb-scripts-group-row"
                style={{ paddingLeft: "8px" }}
                onClick={() => toggle(group.key)}
              >
                <span className={`wb-file-tree-chevron${groupOpen ? " is-expanded" : ""}`}>
                  <ThemeIcon name="chevron-right" size={ICON_SIZE.inline} />
                </span>
                <ThemeIcon name="terminal" size={ICON_SIZE.dense} className="wb-file-tree-icon" />
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
                        <div key={pkg.id} role="group" data-package-id={pkg.id}>
                          <button
                            type="button"
                            className="wb-file-tree-row wb-scripts-package-row"
                            style={{ paddingLeft: `${8 + 14}px` }}
                            onClick={() => toggle(pkg.id)}
                          >
                            <span className={`wb-file-tree-chevron${pkgOpen ? " is-expanded" : ""}`}>
                              <ThemeIcon name="chevron-right" size={ICON_SIZE.inline} />
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
                                  data-script-id={script.id}
                                  className="wb-file-tree-row wb-scripts-script-row"
                                  style={{ paddingLeft: `${8 + 28}px` }}
                                  title={script.detail ? `${script.run.command}\n${script.detail}` : script.run.command}
                                  onClick={() => onRun(script, pkg)}
                                  onDoubleClick={() => onRun(script, pkg)}
                                >
                                  <span className="wb-file-tree-chevron is-placeholder" aria-hidden="true" />
                                  <ThemeIcon name="play" size={ICON_SIZE.dense} className="wb-file-tree-icon wb-scripts-play-icon" />
                                  <span className="wb-file-tree-label">{script.name}</span>
                                </button>
                              ))
                            : null}
                        </div>
                      );
                    }
                    return (
                      <div key={pkg.id} role="group" data-package-id={pkg.id}>
                        {pkg.scripts.map((script) => (
                          <button
                            type="button"
                            key={script.id}
                            data-script-id={script.id}
                            className="wb-file-tree-row wb-scripts-script-row"
                            style={{ paddingLeft: `${8 + 14}px` }}
                            title={script.detail ? `${script.run.command}\n${script.detail}` : script.run.command}
                            onClick={() => onRun(script, pkg)}
                            onDoubleClick={() => onRun(script, pkg)}
                          >
                            <span className="wb-file-tree-chevron is-placeholder" aria-hidden="true" />
                            <ThemeIcon name="play" size={ICON_SIZE.inline} className="wb-file-tree-icon wb-scripts-play-icon" />
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
    <div className={`wb-scripts-pane${compact ? " is-compact" : ""}`} onContextMenu={onPaneContextMenu}>
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
              <ThemeIcon name="refresh" size={ICON_SIZE.default} className={loading ? "spin" : undefined} />
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
              <ThemeIcon name="refresh" size={ICON_SIZE.default} className={loading ? "spin" : undefined} />
            </button>
          ) : null}
        </div>
      )}
      {body}
    </div>
  );
}
