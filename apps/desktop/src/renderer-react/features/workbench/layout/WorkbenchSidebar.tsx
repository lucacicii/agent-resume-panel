import { Fragment, type ReactNode } from "react";
import type { GtdStatus, WorkbenchSessionFolder, WorkbenchSessionFolderAssignment } from "@agent-resume/core";
import { ThemeIcon } from "../../../components/ThemeIcon";
import { SegmentedControl } from "../../../components/SegmentedControl";
import { useI18n } from "../../../i18n";

export type WorkbenchSidebarView = "projects" | "gtd";
export type WorkbenchProjectFilter = "all" | "pinned";

export type WorkbenchSidebarProject = {
  id: string;
  path: string;
  portableKey: string;
  pathMissing: boolean;
  sessionCount: number;
  folders: WorkbenchSessionFolder[];
  folderAssignments: WorkbenchSessionFolderAssignment[];
  pendingCount: number;
  label: string;
  active: boolean;
  pinned: boolean;
};

const GTD_ACTIVE_STATUSES = ["inbox", "next", "waiting", "someday", "reference"] as const satisfies readonly GtdStatus[];

function ProjectFolderRows<T extends WorkbenchSidebarProject>({
  project,
  parentId,
  depth,
  selectedProject,
  selectedFolderId,
  expandedFolderIds,
  dragTargetKey,
  unclassifiedFolderId,
  onFolderMenu,
  onFolderDragOver,
  onFolderDragLeave,
  onFolderDrop,
  onSelectFolder,
  onToggleFolderExpanded
}: {
  project: T;
  parentId: string | null;
  depth: number;
  selectedProject: string | null;
  selectedFolderId: string | null;
  expandedFolderIds: Set<string>;
  dragTargetKey: string | null;
  unclassifiedFolderId: string;
  onFolderMenu: (event: React.MouseEvent, project: T, folder: WorkbenchSessionFolder) => void;
  onFolderDragOver: (event: React.DragEvent, project: T, folderId: string | null, hasChildren?: boolean, expanded?: boolean) => void;
  onFolderDragLeave: (event: React.DragEvent, project: T, folderId: string | null) => void;
  onFolderDrop: (event: React.DragEvent, project: T, folderId: string | null) => void;
  onSelectFolder: (project: T, folderId: string | null) => void;
  onToggleFolderExpanded: (folderId: string) => void;
}): ReactNode {
  const children = project.folders
    .filter((folder) => (folder.parentId || null) === parentId)
    .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: "base" }));
  if (!children.length) return null;
  const assignmentCounts = new Map<string, number>();
  for (const assignment of project.folderAssignments) {
    assignmentCounts.set(assignment.folderId, (assignmentCounts.get(assignment.folderId) || 0) + 1);
  }
  return children.map((folder) => {
    const hasChildren = project.folders.some((candidate) => candidate.parentId === folder.folderId);
    const expanded = expandedFolderIds.has(folder.folderId);
    return <Fragment key={folder.folderId}>
      <button
        type="button"
        className={`wb-folder-row wb-session-folder-row${selectedProject === project.path && selectedFolderId === folder.folderId ? " active" : ""}${dragTargetKey === `${project.id}:${folder.folderId}` ? " is-drop-target" : ""}`}
        style={{ paddingLeft: `${18 + depth * 16}px` }}
        onContextMenu={(event) => onFolderMenu(event, project, folder)}
        onDragOver={(event) => onFolderDragOver(event, project, folder.folderId, hasChildren, expanded)}
        onDragLeave={(event) => onFolderDragLeave(event, project, folder.folderId)}
        onDrop={(event) => onFolderDrop(event, project, folder.folderId)}
        onClick={() => onSelectFolder(project, folder.folderId)}
        title={folder.name}
        aria-expanded={hasChildren ? expanded : undefined}
      >
        <span
          className={`wb-session-folder-chevron${expanded ? " is-expanded" : ""}${hasChildren ? " has-children" : ""}`}
          onClick={(event) => {
            if (!hasChildren) return;
            event.preventDefault();
            event.stopPropagation();
            onToggleFolderExpanded(folder.folderId);
          }}
        ><ThemeIcon name="chevron-right" size={12} aria-hidden="true" /></span>
        <ThemeIcon name="folder" size={14} aria-hidden="true" />
        <span className="wb-folder-row-label">{folder.name}</span>
        <span className="wb-folder-row-count">{assignmentCounts.get(folder.folderId) || 0}</span>
      </button>
      {expanded ? <ProjectFolderRows
        project={project}
        parentId={folder.folderId}
        depth={depth + 1}
        selectedProject={selectedProject}
        selectedFolderId={selectedFolderId}
        expandedFolderIds={expandedFolderIds}
        dragTargetKey={dragTargetKey}
        unclassifiedFolderId={unclassifiedFolderId}
        onFolderMenu={onFolderMenu}
        onFolderDragOver={onFolderDragOver}
        onFolderDragLeave={onFolderDragLeave}
        onFolderDrop={onFolderDrop}
        onSelectFolder={onSelectFolder}
        onToggleFolderExpanded={onToggleFolderExpanded}
      /> : null}
    </Fragment>;
  });
}

export function WorkbenchSidebar<T extends WorkbenchSidebarProject>({
  collapsed,
  sidebarView,
  projectFilter,
  projectQuery,
  selectedProject,
  selectedFolderId,
  selectedGtdStatus,
  completedGtdExpanded,
  expandedProjectIds,
  expandedFolderIds,
  dragTargetKey,
  unclassifiedFolderId,
  projects,
  gtdStatusCounts,
  folderAssignmentKey,
  onSelectSidebarView,
  onProjectQueryChange,
  onProjectFilterChange,
  onSelectAllSessions,
  onAddProject,
  onSelectProject,
  onToggleProjectExpanded,
  onProjectMenu,
  onSelectFolder,
  onFolderMenu,
  onFolderDragOver,
  onFolderDragLeave,
  onFolderDrop,
  onToggleFolderExpanded,
  onSelectGtdStatus,
  onToggleCompletedGtd
}: {
  collapsed: boolean;
  sidebarView: WorkbenchSidebarView;
  projectFilter: WorkbenchProjectFilter;
  projectQuery: string;
  selectedProject: string | null;
  selectedFolderId: string | null;
  selectedGtdStatus: GtdStatus;
  completedGtdExpanded: boolean;
  expandedProjectIds: Set<string>;
  expandedFolderIds: Set<string>;
  dragTargetKey: string | null;
  unclassifiedFolderId: string;
  projects: T[];
  gtdStatusCounts: Map<GtdStatus, number>;
  folderAssignmentKey: (provider: string, agentSessionId: string) => string;
  onSelectSidebarView: (view: WorkbenchSidebarView) => void;
  onProjectQueryChange: (value: string) => void;
  onProjectFilterChange: (filter: WorkbenchProjectFilter) => void;
  onSelectAllSessions: () => void;
  onAddProject: () => void;
  onSelectProject: (path: string) => void;
  onToggleProjectExpanded: (projectId: string) => void;
  onProjectMenu: (event: React.MouseEvent, project: T) => void;
  onSelectFolder: (project: T, folderId: string | null) => void;
  onFolderMenu: (event: React.MouseEvent, project: T, folder: WorkbenchSessionFolder) => void;
  onFolderDragOver: (event: React.DragEvent, project: T, folderId: string | null, hasChildren?: boolean, expanded?: boolean) => void;
  onFolderDragLeave: (event: React.DragEvent, project: T, folderId: string | null) => void;
  onFolderDrop: (event: React.DragEvent, project: T, folderId: string | null) => void;
  onToggleFolderExpanded: (folderId: string) => void;
  onSelectGtdStatus: (status: GtdStatus) => void;
  onToggleCompletedGtd: () => void;
}): React.JSX.Element {
  const { t } = useI18n();
  return <aside className={`sidebar-folders-pane wb-folders-pane${collapsed ? " is-collapsed" : ""}`}>
    <div className="sidebar-project-filter-wrap">
      <SegmentedControl aria-label={t("desktop.workbench.sidebarView")} value={sidebarView} options={["projects", "gtd"] as const satisfies readonly WorkbenchSidebarView[]} onChange={onSelectSidebarView} getLabel={(view) => t(view === "projects" ? "desktop.workbench.projectsView" : "desktop.workbench.gtdView")} className="sidebar-project-filter-segmented wb-sidebar-view-segmented" />
      <div className="sidebar-project-search-wrap"><input type="search" className="sidebar-project-search" aria-label={t(sidebarView === "projects" ? "desktop.workbench.filterProjects" : "desktop.workbench.filterGtdSessions")} placeholder={t(sidebarView === "projects" ? "desktop.workbench.filterProjects" : "desktop.workbench.filterGtdSessions")} value={projectQuery} autoComplete="off" spellCheck={false} onChange={(event) => onProjectQueryChange(event.target.value)} /></div>
      {sidebarView === "projects" ? <SegmentedControl
        aria-label={t("desktop.notes.projectFilter")}
        value={projectFilter}
        options={["all", "pinned"] as const satisfies readonly WorkbenchProjectFilter[]}
        onChange={onProjectFilterChange}
        getLabel={(filter) => t(`desktop.common.${filter}`)}
      /> : null}
    </div>
    <div className="wb-folders">
      {sidebarView === "projects" ? <>
        <button type="button" className={`wb-folder-row${!selectedProject ? " active" : ""}`} onClick={onSelectAllSessions}><span className="wb-folder-row-label">{t("desktop.workbench.allSessions")}</span></button>
        <div className="wb-folder-section">
          <div className="wb-folder-section-head">
            <div className="wb-folder-section-label">{t("desktop.notes.projectFilter")}</div>
            <button type="button" className="wb-icon-btn wb-add-project-btn" aria-label={t("desktop.workbench.addProject")} title={t("desktop.workbench.addProject")} onClick={onAddProject}><ThemeIcon name="plus" size={14} /></button>
          </div>
          {projects.length ? projects.map((project) => {
            const assignedCount = new Set(project.folderAssignments.map((assignment) => folderAssignmentKey(assignment.provider, assignment.agentSessionId))).size;
            const unclassifiedCount = Math.max(0, project.sessionCount - assignedCount) + project.pendingCount;
            const projectExpanded = expandedProjectIds.has(project.id);
            return <Fragment key={project.id}>
              <button type="button" className={`wb-folder-row${selectedProject === project.path || selectedProject === project.id ? " active" : ""}${project.pinned ? " is-pinned" : ""}${project.active ? " has-wb-activity" : ""}${project.pathMissing ? " is-path-missing" : ""}`} title={project.pathMissing ? t("desktop.workbench.pathMissingHint") : project.path} aria-expanded={projectExpanded} onContextMenu={(event) => onProjectMenu(event, project)} onClick={() => onSelectProject(project.path)}><span className={`wb-session-folder-chevron has-children${projectExpanded ? " is-expanded" : ""}`} onClick={(event) => { event.preventDefault(); event.stopPropagation(); onToggleProjectExpanded(project.id); }}><ThemeIcon name="chevron-right" size={12} aria-hidden="true" /></span>{project.pinned ? <ThemeIcon name="pin" className="project-pin-icon" size={12} aria-hidden="true" /> : null}{project.active ? <span className="wb-folder-activity-dot" aria-hidden="true" /> : null}<span className="wb-folder-row-text"><span className="wb-folder-row-label">{project.label}</span><span className="wb-folder-row-desc">{project.pathMissing ? t("desktop.workbench.pathMissingLabel", project.portableKey) : project.path}</span></span><span className="wb-folder-row-count">{project.sessionCount + project.pendingCount}</span></button>
              {projectExpanded ? <>
                <button
                  type="button"
                  className={`wb-folder-row wb-session-folder-root${selectedProject === project.path && selectedFolderId === unclassifiedFolderId ? " active" : ""}${dragTargetKey === `${project.id}:${unclassifiedFolderId}` ? " is-drop-target" : ""}`}
                  onDragOver={(event) => onFolderDragOver(event, project, null)}
                  onDragLeave={(event) => onFolderDragLeave(event, project, null)}
                  onDrop={(event) => onFolderDrop(event, project, null)}
                  onClick={() => onSelectFolder(project, unclassifiedFolderId)}
                ><ThemeIcon name="folder-open" size={14} aria-hidden="true" /><span className="wb-folder-row-label">{t("desktop.workbench.unclassifiedSessions")}</span><span className="wb-folder-row-count">{unclassifiedCount}</span></button>
                <ProjectFolderRows
                  project={project}
                  parentId={null}
                  depth={0}
                  selectedProject={selectedProject}
                  selectedFolderId={selectedFolderId}
                  expandedFolderIds={expandedFolderIds}
                  dragTargetKey={dragTargetKey}
                  unclassifiedFolderId={unclassifiedFolderId}
                  onFolderMenu={onFolderMenu}
                  onFolderDragOver={onFolderDragOver}
                  onFolderDragLeave={onFolderDragLeave}
                  onFolderDrop={onFolderDrop}
                  onSelectFolder={onSelectFolder}
                  onToggleFolderExpanded={onToggleFolderExpanded}
                />
              </> : null}
            </Fragment>;
          }) : <p className="muted wb-folders-empty">{t("desktop.workbench.noProjects")}</p>}
        </div>
      </> : <div className="wb-folder-section wb-gtd-folder-section"><div className="wb-folder-section-label">{t("desktop.workbench.gtdView")}</div>{GTD_ACTIVE_STATUSES.map((gtdStatus) => <button type="button" className={`wb-folder-row wb-gtd-folder-row${selectedGtdStatus === gtdStatus ? " active" : ""}`} key={gtdStatus} onClick={() => onSelectGtdStatus(gtdStatus)}><span className={`wb-gtd-status-dot is-${gtdStatus}`} aria-hidden="true" /><span className="wb-folder-row-label">{t(`desktop.workbench.gtdStatus.${gtdStatus}`)}</span><span className="wb-folder-row-count">{gtdStatusCounts.get(gtdStatus) || 0}</span></button>)}<div className="wb-gtd-completed-group"><button type="button" className="wb-folder-row wb-gtd-folder-row wb-gtd-completed-toggle" aria-expanded={completedGtdExpanded} onClick={onToggleCompletedGtd}><ThemeIcon name="chevron-right" className={completedGtdExpanded ? "is-expanded" : ""} size={14} aria-hidden="true" /><span className="wb-folder-row-label">{t("desktop.workbench.gtdCompleted")}</span><span className="wb-folder-row-count">{gtdStatusCounts.get("done") || 0}</span></button>{completedGtdExpanded ? <button type="button" className={`wb-folder-row wb-gtd-folder-row wb-gtd-completed-child${selectedGtdStatus === "done" ? " active" : ""}`} onClick={() => onSelectGtdStatus("done")}><span className="wb-gtd-status-dot is-done" aria-hidden="true" /><span className="wb-folder-row-label">{t("desktop.workbench.gtdStatus.done")}</span><span className="wb-folder-row-count">{gtdStatusCounts.get("done") || 0}</span></button> : null}</div></div>}
    </div>
  </aside>;
}
