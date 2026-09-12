import type { RefObject } from "react";
import { ThemeIcon } from "../../../components/ThemeIcon";
import { useI18n } from "../../../i18n";
import type { QuickAccessProject } from "../QuickAccess";
import { type WorkbenchSearchMatch, groupSearchMatches } from "../WorkbenchSearchPane";

export function WorkbenchSearchSidePane({
  selectedProject,
  searchQuery,
  onSearchQueryChange,
  searchProjectMode,
  searchProjectQuery,
  onSearchProjectQueryChange,
  searchProjectResults,
  searchProjectActive,
  searchProjectActiveIndex,
  searchProjectLabel,
  searchProjectOptionId,
  searchProjectOptionRefs,
  onEnterSearchProjectMode,
  onLeaveSearchProjectMode,
  onMoveSearchProjectSelection,
  onActivateSearchProject,
  onSearchProjectSelectionId,
  searchMatchCase,
  searchWholeWord,
  searchUseRegex,
  onToggleMatchCase,
  onToggleWholeWord,
  onToggleUseRegex,
  searchDetailsOpen,
  searchReplaceOpen,
  onToggleDetails,
  onToggleReplace,
  searchReplaceText,
  onSearchReplaceTextChange,
  searchFilesInclude,
  onSearchFilesIncludeChange,
  searchFilesExclude,
  onSearchFilesExcludeChange,
  searchInputRef,
  searchReplaceInputRef,
  searchIncludeInputRef,
  searchExcludeInputRef,
  searchLoading,
  searchError,
  searchTruncated,
  searchGroups,
  searchFileCount,
  searchMatchCount,
  searchExpanded,
  onToggleGroup,
  searchSelectedKey,
  searchReplaceVisible,
  searchReplacing,
  onRunSearch,
  onReplace,
  onOpenMatch
}: {
  selectedProject: string | null;
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  searchProjectMode: boolean;
  searchProjectQuery: string;
  onSearchProjectQueryChange: (value: string) => void;
  searchProjectResults: QuickAccessProject[];
  searchProjectActive: QuickAccessProject | undefined;
  searchProjectActiveIndex: number;
  searchProjectLabel: string;
  searchProjectOptionId: (projectId: string) => string;
  searchProjectOptionRefs: RefObject<Map<string, HTMLButtonElement>>;
  onEnterSearchProjectMode: () => void;
  onLeaveSearchProjectMode: () => void;
  onMoveSearchProjectSelection: (offset: -1 | 1) => void;
  onActivateSearchProject: (project?: QuickAccessProject) => void;
  onSearchProjectSelectionId: (id: string) => void;
  searchMatchCase: boolean;
  searchWholeWord: boolean;
  searchUseRegex: boolean;
  onToggleMatchCase: () => void;
  onToggleWholeWord: () => void;
  onToggleUseRegex: () => void;
  searchDetailsOpen: boolean;
  searchReplaceOpen: boolean;
  onToggleDetails: () => void;
  onToggleReplace: () => void;
  searchReplaceText: string;
  onSearchReplaceTextChange: (value: string) => void;
  searchFilesInclude: string;
  onSearchFilesIncludeChange: (value: string) => void;
  searchFilesExclude: string;
  onSearchFilesExcludeChange: (value: string) => void;
  searchInputRef: RefObject<HTMLInputElement | null>;
  searchReplaceInputRef: RefObject<HTMLInputElement | null>;
  searchIncludeInputRef: RefObject<HTMLInputElement | null>;
  searchExcludeInputRef: RefObject<HTMLInputElement | null>;
  searchLoading: boolean;
  searchError: string;
  searchTruncated: boolean;
  searchGroups: ReturnType<typeof groupSearchMatches>;
  searchFileCount: number;
  searchMatchCount: number;
  searchExpanded: Set<string>;
  onToggleGroup: (path: string) => void;
  searchSelectedKey: string;
  searchReplaceVisible: boolean;
  searchReplacing: boolean;
  onRunSearch: () => void;
  onReplace: (files: string[], onlyByPath?: Map<string, number>) => void;
  onOpenMatch: (match: WorkbenchSearchMatch, key: string) => void;
}): React.JSX.Element {
  const { t } = useI18n();
  return <div className="wb-side-pane">
    <div className="wb-side-pane-head"><span className="wb-side-pane-title">{t("desktop.workbench.sidePanelSearch")}</span></div>
    <div className="wb-search-pane">
      <div className="wb-search-form" role="search">
        <input
          ref={searchInputRef}
          type="search"
          role={searchProjectMode ? "combobox" : undefined}
          className="wb-search-input"
          value={searchProjectMode ? searchProjectQuery : searchQuery}
          placeholder={t(searchProjectMode ? "desktop.workbench.quickAccessProjectPlaceholder" : "desktop.workbench.searchPlaceholder")}
          aria-label={t(searchProjectMode ? "desktop.workbench.quickAccessSelectProject" : "desktop.workbench.sidePanelSearch")}
          aria-expanded={searchProjectMode ? true : undefined}
          aria-controls={searchProjectMode ? "wb-search-project-results" : undefined}
          aria-activedescendant={searchProjectMode && searchProjectActive ? searchProjectOptionId(searchProjectActive.id) : undefined}
          aria-autocomplete={searchProjectMode ? "list" : undefined}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => searchProjectMode
            ? onSearchProjectQueryChange(event.target.value)
            : onSearchQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (searchProjectMode) {
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                onLeaveSearchProjectMode();
              } else if (event.key === "ArrowDown") {
                event.preventDefault();
                onMoveSearchProjectSelection(1);
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                onMoveSearchProjectSelection(-1);
              } else if (event.key === "Home") {
                event.preventDefault();
                onSearchProjectSelectionId(searchProjectResults[0]?.id || "");
              } else if (event.key === "End") {
                event.preventDefault();
                onSearchProjectSelectionId(searchProjectResults[searchProjectResults.length - 1]?.id || "");
              } else if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                event.preventDefault();
                onActivateSearchProject();
              }
              return;
            }
            if (event.key === "ArrowLeft"
              && event.currentTarget.selectionStart === 0
              && event.currentTarget.selectionEnd === 0) {
              event.preventDefault();
              onEnterSearchProjectMode();
            } else if (event.key === "Enter" && !event.nativeEvent.isComposing) {
              event.preventDefault();
              onRunSearch();
            }
          }}
        />
        {!searchProjectMode ? <>
          <button
            type="button"
            className="wb-search-scope"
            aria-label={t("desktop.workbench.quickAccessSelectProject")}
            title={searchProjectLabel}
            onClick={onEnterSearchProjectMode}
          ><ThemeIcon name="chevron-left" size={13} aria-hidden="true" /><span>{searchProjectLabel}</span></button>
          <div className="wb-search-options" role="group" aria-label={t("desktop.workbench.searchOptions")}>
            <button type="button" className={`wb-search-option${searchMatchCase ? " active" : ""}`} aria-pressed={searchMatchCase} title={t("desktop.workbench.searchMatchCase")} onClick={onToggleMatchCase}>Aa</button>
            <button type="button" className={`wb-search-option${searchWholeWord ? " active" : ""}`} aria-pressed={searchWholeWord} title={t("desktop.workbench.searchWholeWord")} onClick={onToggleWholeWord}>Ab</button>
            <button type="button" className={`wb-search-option${searchUseRegex ? " active" : ""}`} aria-pressed={searchUseRegex} title={t("desktop.workbench.searchUseRegex")} onClick={onToggleUseRegex}>.*</button>
            <span className="wb-search-options-spacer" aria-hidden="true" />
            <button type="button" className={`wb-search-option wb-search-option-icon${searchDetailsOpen ? " active" : ""}`} aria-pressed={searchDetailsOpen} aria-label={t("desktop.workbench.searchToggleDetails")} title={t("desktop.workbench.searchToggleDetails")} onClick={onToggleDetails}><ThemeIcon name="ellipsis" size={14} aria-hidden="true" /></button>
            <button type="button" className={`wb-search-option wb-search-option-icon${searchReplaceOpen ? " active" : ""}`} aria-pressed={searchReplaceOpen} aria-label={t("desktop.workbench.searchToggleReplace")} title={t("desktop.workbench.searchToggleReplace")} onClick={onToggleReplace}><ThemeIcon name="replace" size={14} aria-hidden="true" /></button>
          </div>
          {searchReplaceOpen || searchDetailsOpen ? <div className="wb-search-extras">
            {searchReplaceOpen ? <input
              ref={searchReplaceInputRef}
              type="search"
              className="wb-search-input"
              value={searchReplaceText}
              placeholder={t("desktop.workbench.searchReplacePlaceholder")}
              aria-label={t("desktop.workbench.searchReplacePlaceholder")}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => onSearchReplaceTextChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  if (searchReplaceVisible && searchGroups.length) {
                    onReplace(searchGroups.map((group) => group.path));
                  }
                }
              }}
            /> : null}
            {searchDetailsOpen ? <>
              <label className="wb-search-glob-row"><span className="wb-search-glob-label">{t("desktop.workbench.searchFilesToInclude")}</span><input
                ref={searchIncludeInputRef}
                type="search"
                className="wb-search-input wb-search-glob-input"
                value={searchFilesInclude}
                placeholder={t("desktop.workbench.searchFilesToIncludePlaceholder")}
                aria-label={t("desktop.workbench.searchFilesToInclude")}
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => onSearchFilesIncludeChange(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); onRunSearch(); } }}
              /></label>
              <label className="wb-search-glob-row"><span className="wb-search-glob-label">{t("desktop.workbench.searchFilesToExclude")}</span><input
                ref={searchExcludeInputRef}
                type="search"
                className="wb-search-input wb-search-glob-input"
                value={searchFilesExclude}
                placeholder={t("desktop.workbench.searchFilesToExcludePlaceholder")}
                aria-label={t("desktop.workbench.searchFilesToExclude")}
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => onSearchFilesExcludeChange(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); onRunSearch(); } }}
              /></label>
            </> : null}
          </div> : null}
        </> : null}
      </div>
      {searchProjectMode ? <div className="wb-search-project-results" id="wb-search-project-results" role="listbox">
        {searchProjectResults.length ? searchProjectResults.map((project, index) => {
          const disabled = Boolean(project.disabledReason);
          const selected = index === searchProjectActiveIndex;
          return <button
            ref={(node) => {
              const refs = searchProjectOptionRefs.current;
              if (!refs) return;
              if (node) refs.set(project.id, node);
              else refs.delete(project.id);
            }}
            type="button"
            role="option"
            id={searchProjectOptionId(project.id)}
            aria-selected={selected}
            aria-disabled={disabled}
            className={`wb-search-project-row${selected ? " is-selected" : ""}${disabled ? " is-disabled" : ""}`}
            key={project.id}
            onMouseMove={() => onSearchProjectSelectionId(project.id)}
            onClick={() => onActivateSearchProject(project)}
          >
            <ThemeIcon name="folder" size={15} aria-hidden="true" />
            <span className="wb-search-project-copy"><span className="wb-search-project-label">{project.label}</span><span className="wb-search-project-detail">{project.disabledReason || project.detail}</span></span>
            {project.pinned ? <ThemeIcon name="pin" size={12} aria-hidden="true" /> : null}
          </button>;
        }) : <p className="muted wb-search-status">{t("desktop.workbench.quickAccessNoProjects")}</p>}
      </div> : !selectedProject ? <p className="muted wb-file-tree-empty">{t("desktop.workbench.sidePanelNoRoot")}</p> : searchLoading ? <p className="muted wb-search-status" role="status">{t("desktop.workbench.searchSearching")}</p> : searchError ? <p className="muted wb-search-status is-error" role="alert">{searchError}</p> : !searchQuery.trim() ? <p className="muted wb-search-status">{t("desktop.workbench.searchHint")}</p> : !searchMatchCount ? <p className="muted wb-search-status">{t("desktop.workbench.searchNoResults")}</p> : <><div className="wb-search-meta-row" aria-live="polite"><p className="wb-search-meta">{t("desktop.workbench.searchResultSummary", String(searchMatchCount), String(searchFileCount))}{searchTruncated ? ` · ${t("desktop.workbench.searchTruncated")}` : ""}</p>{searchReplaceOpen ? <button type="button" className="wb-search-replace-all" disabled={!searchReplaceVisible} title={searchTruncated ? t("desktop.workbench.searchReplaceLimited") : t("desktop.workbench.searchReplaceAll")} onClick={() => onReplace(searchGroups.map((group) => group.path))}><ThemeIcon name="replace-all" size={13} aria-hidden="true" />{t("desktop.workbench.searchReplaceAll")}</button> : null}</div><div className="wb-search-results" role="tree">{searchGroups.map((group) => { const expanded = searchExpanded.has(group.path); return <div className="wb-search-file-group" key={group.path} role="treeitem" aria-expanded={expanded}><div className="wb-search-file-row"><button type="button" className="wb-search-file-main" onClick={() => onToggleGroup(group.path)}><span className={`wb-file-tree-chevron${expanded ? " is-expanded" : ""}`}><ThemeIcon name="chevron-right" size={12} /></span><ThemeIcon name="file-code" size={14} className="wb-file-tree-icon" /><span className="wb-search-file-label" title={group.path}>{group.relativePath}</span><span className="wb-search-file-count">{group.matches.length}</span></button>{searchReplaceOpen ? <button type="button" className="wb-search-action-btn" disabled={searchReplacing || searchLoading} title={t("desktop.workbench.searchReplaceInFile")} aria-label={t("desktop.workbench.searchReplaceInFile")} onClick={(event) => { event.stopPropagation(); onReplace([group.path]); }}><ThemeIcon name="replace-all" size={13} aria-hidden="true" /></button> : null}</div>{expanded ? <div className="wb-search-match-list" role="group">{group.matches.map((match, index) => { const key = `${match.path}:${match.line}:${match.column}:${index}`; return <div className={`wb-search-match-row${searchSelectedKey === key ? " is-selected" : ""}`} key={key}><button type="button" className="wb-search-match-main" onClick={() => onOpenMatch(match, key)}><span className="wb-search-match-line">{match.line}</span><span className="wb-search-match-preview">{match.preview}</span></button>{searchReplaceOpen ? <button type="button" className="wb-search-action-btn" disabled={searchReplacing || searchLoading} title={t("desktop.workbench.searchReplaceMatch")} aria-label={t("desktop.workbench.searchReplaceMatch")} onClick={(event) => { event.stopPropagation(); onReplace([match.path], new Map([[match.path, index]])); }}><ThemeIcon name="replace" size={12} aria-hidden="true" /></button> : null}</div>; })}</div> : null}</div>; })}</div></>}
    </div>
  </div>;
}
