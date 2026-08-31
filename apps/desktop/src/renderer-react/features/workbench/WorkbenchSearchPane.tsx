import { ThemeIcon } from "../../components/ThemeIcon";
import { useEffect, useMemo, useState } from "react";
import { useI18n } from "../../i18n";

export type WorkbenchSearchMatch = {
  path: string;
  relativePath: string;
  line: number;
  column: number;
  endColumn: number;
  preview: string;
};

export function groupSearchMatches(matches: WorkbenchSearchMatch[]): Array<{
  path: string;
  relativePath: string;
  matches: WorkbenchSearchMatch[];
}> {
  const groups: Array<{ path: string; relativePath: string; matches: WorkbenchSearchMatch[] }> = [];
  const indexByPath = new Map<string, number>();
  for (const match of matches) {
    const existing = indexByPath.get(match.path);
    if (existing === undefined) {
      indexByPath.set(match.path, groups.length);
      groups.push({ path: match.path, relativePath: match.relativePath, matches: [match] });
    } else {
      groups[existing].matches.push(match);
    }
  }
  return groups;
}

export function WorkbenchSearchPane({
  hasProject,
  query,
  onQueryChange,
  onSubmit,
  matchCase,
  wholeWord,
  useRegex,
  onToggleMatchCase,
  onToggleWholeWord,
  onToggleUseRegex,
  loading,
  error,
  truncated,
  matches,
  selectedKey,
  onOpenMatch
}: {
  hasProject: boolean;
  query: string;
  onQueryChange: (value: string) => void;
  onSubmit: () => void;
  matchCase: boolean;
  wholeWord: boolean;
  useRegex: boolean;
  onToggleMatchCase: () => void;
  onToggleWholeWord: () => void;
  onToggleUseRegex: () => void;
  loading: boolean;
  error: string;
  truncated: boolean;
  matches: WorkbenchSearchMatch[];
  selectedKey: string;
  onOpenMatch: (match: WorkbenchSearchMatch) => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const groups = useMemo(() => groupSearchMatches(matches), [matches]);
  const groupKey = groups.map((group) => group.path).join("\0");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    setExpanded(new Set(groupKey ? groupKey.split("\0").slice(0, 20) : []));
  }, [groupKey]);
  const fileCount = groups.length;
  const matchCount = matches.length;

  let body: React.ReactNode;
  if (!hasProject) {
    body = <p className="muted wb-file-tree-empty">{t("desktop.workbench.sidePanelNoRoot")}</p>;
  } else if (loading) {
    body = <p className="muted wb-search-status" role="status">{t("desktop.workbench.searchSearching")}</p>;
  } else if (error) {
    body = <p className="muted wb-search-status is-error" role="alert">{error}</p>;
  } else if (!query.trim()) {
    body = <p className="muted wb-search-status">{t("desktop.workbench.searchHint")}</p>;
  } else if (!matchCount) {
    body = <p className="muted wb-search-status">{t("desktop.workbench.searchNoResults")}</p>;
  } else {
    body = <>
      <p className="wb-search-meta" aria-live="polite">
        {t("desktop.workbench.searchResultSummary", String(matchCount), String(fileCount))}
        {truncated ? ` · ${t("desktop.workbench.searchTruncated")}` : ""}
      </p>
      <div className="wb-search-results" role="tree">
        {groups.map((group) => {
          const isExpanded = expanded.has(group.path);
          const toggle = () => setExpanded((current) => {
            const next = new Set(current);
            if (next.has(group.path)) next.delete(group.path);
            else next.add(group.path);
            return next;
          });
          return (
            <div className="wb-search-file-group" key={group.path} role="treeitem" aria-expanded={isExpanded}>
              <button type="button" className="wb-search-file-row" onClick={toggle}>
                <span className={`wb-file-tree-chevron${isExpanded ? " is-expanded" : ""}`}>
                  <ThemeIcon name="chevron-right" size={12} />
                </span>
                <ThemeIcon name="file-code" size={14} className="wb-file-tree-icon" />
                <span className="wb-search-file-label" title={group.path}>{group.relativePath}</span>
                <span className="wb-search-file-count">{group.matches.length}</span>
              </button>
              {isExpanded ? (
                <div className="wb-search-match-list" role="group">
                  {group.matches.map((match, index) => {
                    const key = `${match.path}:${match.line}:${match.column}:${index}`;
                    return (
                      <button
                        type="button"
                        className={`wb-search-match-row${selectedKey === key ? " is-selected" : ""}`}
                        key={key}
                        onClick={() => onOpenMatch(match)}
                      >
                        <span className="wb-search-match-line">{match.line}</span>
                        <span className="wb-search-match-preview">{match.preview}</span>
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </>;
  }

  return (
    <div className="wb-side-pane">
      <div className="wb-side-pane-head">
        <span className="wb-side-pane-title">{t("desktop.workbench.sidePanelSearch")}</span>
      </div>
      <div className="wb-search-pane">
        <div className="wb-search-form" role="search">
          <input
            type="search"
            className="wb-search-input"
            value={query}
            placeholder={t("desktop.workbench.searchPlaceholder")}
            aria-label={t("desktop.workbench.sidePanelSearch")}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => onQueryChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                event.preventDefault();
                onSubmit();
              }
            }}
          />
          <div className="wb-search-options" role="group" aria-label={t("desktop.workbench.searchOptions")}>
            <button type="button" className={`wb-search-option${matchCase ? " active" : ""}`} aria-pressed={matchCase} title={t("desktop.workbench.searchMatchCase")} onClick={onToggleMatchCase}>Aa</button>
            <button type="button" className={`wb-search-option${wholeWord ? " active" : ""}`} aria-pressed={wholeWord} title={t("desktop.workbench.searchWholeWord")} onClick={onToggleWholeWord}>Ab</button>
            <button type="button" className={`wb-search-option${useRegex ? " active" : ""}`} aria-pressed={useRegex} title={t("desktop.workbench.searchUseRegex")} onClick={onToggleUseRegex}>.*</button>
          </div>
        </div>
        {body}
      </div>
    </div>
  );
}
