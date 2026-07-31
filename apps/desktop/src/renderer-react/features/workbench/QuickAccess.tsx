import { ThemeIcon } from "../../components/ThemeIcon";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  compareQuickAccessPathMatches,
  fuzzyMatchPath,
  matchQuickAccessPath,
  normalizeQuickAccessQuery,
  type FuzzyPathMatch
} from "../../../shared/quickAccessPathMatch";

export { fuzzyMatchPath } from "../../../shared/quickAccessPathMatch";
export type { FuzzyPathMatch } from "../../../shared/quickAccessPathMatch";

export type QuickAccessMode = "files" | "projects" | "commands";

export interface QuickAccessFile {
  path: string;
  relativePath: string;
  kind?: "file" | "directory";
}

export interface QuickAccessCommand {
  id: string;
  label: string;
  detail?: string;
  keywords?: string;
  shortcut?: string;
  disabledReason?: string;
  run: () => void | Promise<void>;
}

export interface QuickAccessProject {
  id: string;
  path: string;
  label: string;
  detail: string;
  pinned?: boolean;
  disabledReason?: string;
}

export interface QuickAccessLabels {
  filePlaceholder: string;
  projectPlaceholder: string;
  commandPlaceholder: string;
  loading: string;
  noFiles: string;
  noProjects: string;
  noCommands: string;
  noProject: string;
  truncated: string;
  close: string;
  dialog: string;
  selectProject: string;
}

export function rankQuickAccessFiles(
  files: QuickAccessFile[],
  query: string,
  recentPaths: string[] = [],
  limit = 100
): Array<QuickAccessFile & FuzzyPathMatch> {
  const recentRank = new Map(recentPaths.map((filePath, index) => [filePath, index]));
  const needle = normalizeQuickAccessQuery(query);
  return files
    .map((file) => {
      if (!needle && file.kind === "directory") return null;
      return matchQuickAccessPath(file, query);
    })
    .filter((file): file is QuickAccessFile & FuzzyPathMatch => Boolean(file))
    .sort((a, b) => {
      if (!normalizeQuickAccessQuery(query)) {
        const aRecent = recentRank.get(a.path);
        const bRecent = recentRank.get(b.path);
        if (aRecent !== undefined || bRecent !== undefined) {
          if (aRecent === undefined) return 1;
          if (bRecent === undefined) return -1;
          return aRecent - bRecent;
        }
      }
      return compareQuickAccessPathMatches(a, b);
    })
    .slice(0, limit);
}

export function rankQuickAccessProjects(
  projects: QuickAccessProject[],
  query: string
): QuickAccessProject[] {
  if (!normalizeQuickAccessQuery(query)) return projects;
  return projects
    .map((project) => ({
      project,
      match: fuzzyMatchPath(`${project.label}/${project.detail}`, query)
    }))
    .filter((entry): entry is { project: QuickAccessProject; match: FuzzyPathMatch } => Boolean(entry.match))
    .sort((a, b) => b.match.score - a.match.score || a.project.label.localeCompare(b.project.label))
    .map((entry) => entry.project);
}

function highlightPath(value: string, indices: number[]): React.JSX.Element {
  const matched = new Set(indices);
  const parts: React.ReactNode[] = [];
  let current = "";
  let currentMatched = false;
  for (let index = 0; index < value.length; index += 1) {
    const nextMatched = matched.has(index);
    if (current && nextMatched !== currentMatched) {
      parts.push(currentMatched ? <mark key={parts.length}>{current}</mark> : current);
      current = "";
    }
    currentMatched = nextMatched;
    current += value[index];
  }
  if (current) parts.push(currentMatched ? <mark key={parts.length}>{current}</mark> : current);
  return <>{parts}</>;
}

function basename(filePath: string): string {
  const parts = filePath.split("/");
  return parts[parts.length - 1] || filePath;
}

function dirname(filePath: string): string {
  const index = filePath.lastIndexOf("/");
  return index > 0 ? filePath.slice(0, index) : "";
}

function optionId(kind: "file" | "project" | "command", value: string): string {
  return `quick-access-option-${kind}-${encodeURIComponent(value)}`;
}

export function QuickAccess({
  open,
  mode,
  query,
  files,
  projects,
  commands,
  recentPaths,
  loading,
  truncated,
  error,
  projectLabel,
  currentProjectPath,
  labels,
  onModeChange,
  onQueryChange,
  onEnterProjectMode,
  onLeaveProjectMode,
  onClose,
  onOpenFile,
  onOpenDirectory,
  onSelectProject
}: {
  open: boolean;
  mode: QuickAccessMode;
  query: string;
  files: QuickAccessFile[];
  projects: QuickAccessProject[];
  commands: QuickAccessCommand[];
  recentPaths: string[];
  loading: boolean;
  truncated: boolean;
  error: string;
  projectLabel: string;
  currentProjectPath: string;
  labels: QuickAccessLabels;
  onModeChange: (mode: QuickAccessMode) => void;
  onQueryChange: (query: string) => void;
  onEnterProjectMode?: () => void;
  onLeaveProjectMode?: () => void;
  onClose: () => void;
  onOpenFile: (file: QuickAccessFile) => void | Promise<void>;
  onOpenDirectory?: (directory: QuickAccessFile) => void | Promise<void>;
  onSelectProject: (project: QuickAccessProject) => void | Promise<void>;
}): React.JSX.Element | null {
  const inputRef = useRef<HTMLInputElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const optionRefs = useRef(new Map<string, HTMLButtonElement>());
  const savedFileQueryRef = useRef("");
  const selectionContextRef = useRef("");
  const [selectedOptionKey, setSelectedOptionKey] = useState<string | null>(null);
  const fileResults = useMemo(
    () => rankQuickAccessFiles(files, query, recentPaths),
    [files, query, recentPaths]
  );
  const commandResults = useMemo(() => commands
    .map((command) => ({ command, match: fuzzyMatchPath(`${command.label} ${command.keywords || ""}`, query) }))
    .filter((entry): entry is { command: QuickAccessCommand; match: FuzzyPathMatch } => Boolean(entry.match))
    .sort((a, b) => b.match.score - a.match.score || a.command.label.localeCompare(b.command.label))
    .map((entry) => entry.command), [commands, query]);
  const projectResults = useMemo(() => rankQuickAccessProjects(projects, query), [projects, query]);
  const resultOptionKeys = useMemo(() => mode === "files"
    ? fileResults.map((file) => optionId("file", file.path))
    : mode === "projects"
      ? projectResults.map((project) => optionId("project", project.id))
      : commandResults.map((command) => optionId("command", command.id)),
  [commandResults, fileResults, mode, projectResults]);
  const resultCount = resultOptionKeys.length;
  const currentProjectKey = mode === "projects" && !normalizeQuickAccessQuery(query)
    ? projectResults.find((project) => project.path === currentProjectPath)?.id
    : undefined;
  const preferredOptionKey = currentProjectKey
    ? optionId("project", currentProjectKey)
    : resultOptionKeys[0] || null;
  const resultKeySignature = resultOptionKeys.join("\0");
  const selectionContext = `${mode}\0${query}\0${currentProjectKey || ""}`;
  const selectedResultIndex = selectedOptionKey ? resultOptionKeys.indexOf(selectedOptionKey) : -1;
  const activeIndex = selectedResultIndex >= 0 ? selectedResultIndex : resultCount ? 0 : -1;
  const activeId = activeIndex >= 0 ? resultOptionKeys[activeIndex] : undefined;

  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => {
      const input = inputRef.current;
      input?.focus();
      if (input?.value.startsWith(">")) {
        input.setSelectionRange(input.value.length, input.value.length);
      } else {
        input?.select();
      }
    });
    return () => {
      window.cancelAnimationFrame(frame);
      previousFocusRef.current?.focus();
      previousFocusRef.current = null;
    };
  }, [open]);

  useEffect(() => {
    const contextChanged = selectionContextRef.current !== selectionContext;
    selectionContextRef.current = selectionContext;
    setSelectedOptionKey((current) => {
      if (!contextChanged && current && resultOptionKeys.includes(current)) return current;
      return preferredOptionKey;
    });
  }, [preferredOptionKey, resultKeySignature, selectionContext]);
  useEffect(() => {
    if (!activeId) return;
    optionRefs.current.get(activeId)?.scrollIntoView?.({ block: "nearest" });
  }, [activeId]);

  if (!open) return null;
  const displayValue = mode === "commands" ? `>${query}` : query;
  const mac = typeof navigator !== "undefined" && /mac/i.test(navigator.platform);

  const enterProjectMode = () => {
    if (mode !== "files") return;
    if (onEnterProjectMode) {
      onEnterProjectMode();
      return;
    }
    savedFileQueryRef.current = query;
    onModeChange("projects");
    onQueryChange("");
  };

  const leaveProjectMode = () => {
    if (onLeaveProjectMode) {
      onLeaveProjectMode();
      return;
    }
    onModeChange("files");
    onQueryChange(savedFileQueryRef.current);
  };

  const activate = () => {
    if (activeIndex < 0) return;
    if (mode === "files") {
      const entry = fileResults[activeIndex];
      if (entry.kind === "directory") void onOpenDirectory?.(entry);
      else void onOpenFile(entry);
    }
    else if (mode === "projects") {
      const project = projectResults[activeIndex];
      if (!project.disabledReason) {
        void onSelectProject(project);
        leaveProjectMode();
      }
    } else if (!commandResults[activeIndex].disabledReason) void commandResults[activeIndex].run();
  };

  const selectResult = (index: number) => {
    setSelectedOptionKey(resultOptionKeys[index] || null);
  };

  const moveSelection = (offset: -1 | 1) => {
    if (!resultCount) return;
    if (activeIndex < 0) {
      selectResult(offset > 0 ? 0 : resultCount - 1);
      return;
    }
    selectResult((activeIndex + offset + resultCount) % resultCount);
  };

  return <div className="quick-access-overlay">
    <button type="button" className="quick-access-backdrop" aria-label={labels.close} onClick={onClose} />
    <section className="quick-access-panel" role="dialog" aria-modal="true" aria-label={labels.dialog}>
      <div className="quick-access-input-row">
        {mode === "files" ? <ThemeIcon name="search" size={17} aria-hidden="true" /> : mode === "projects" ? <ThemeIcon name="folder" size={17} aria-hidden="true" /> : <ThemeIcon name="command" size={17} aria-hidden="true" />}
        <input
          ref={inputRef}
          className="quick-access-input"
          role="combobox"
          aria-expanded="true"
          aria-controls="quick-access-results"
          aria-activedescendant={activeId}
          aria-autocomplete="list"
          value={displayValue}
          placeholder={mode === "files" ? labels.filePlaceholder : mode === "projects" ? labels.projectPlaceholder : labels.commandPlaceholder}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => {
            const value = event.target.value;
            if (mode === "projects") {
              onQueryChange(value);
              return;
            }
            if (value.startsWith(">")) {
              if (mode !== "commands") onModeChange("commands");
              onQueryChange(value.slice(1));
            } else {
              if (mode !== "files") onModeChange("files");
              onQueryChange(value);
            }
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              if (mode === "projects") leaveProjectMode();
              else onClose();
            } else if (event.key === "ArrowLeft" && mode === "files"
              && event.currentTarget.selectionStart === 0
              && event.currentTarget.selectionEnd === 0) {
              event.preventDefault();
              enterProjectMode();
            } else if (event.key === "ArrowDown") {
              event.preventDefault();
              moveSelection(1);
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              moveSelection(-1);
            } else if (event.key === "Home") {
              event.preventDefault();
              selectResult(0);
            } else if (event.key === "End") {
              event.preventDefault();
              selectResult(resultCount - 1);
            } else if (event.key === "Enter" && !event.nativeEvent.isComposing) {
              event.preventDefault();
              activate();
            }
          }}
        />
        <kbd>{mode === "files" ? (mac ? "⌘P" : "Ctrl+P") : mode === "projects" ? "↵" : (mac ? "⌘⇧P" : "Ctrl+Shift+P")}</kbd>
      </div>
      {mode === "files" && projectLabel ? <button type="button" className="quick-access-scope" aria-label={labels.selectProject} onClick={enterProjectMode}><ThemeIcon name="chevron-left" size={13} aria-hidden="true" /><span>{projectLabel}</span></button> : null}
      <div className="quick-access-results" id="quick-access-results" role="listbox">
        {mode === "files" ? <>
          {!projectLabel ? <p className="quick-access-state">{labels.noProject}</p> : loading && !files.length ? <p className="quick-access-state"><ThemeIcon name="loader" className="spin" size={15} />{labels.loading}</p> : error ? <p className="quick-access-state is-error" role="alert">{error}</p> : fileResults.length ? fileResults.map((file, index) => {
            const id = optionId("file", file.path);
            const name = basename(file.relativePath);
            const directory = dirname(file.relativePath);
            const nameOffset = file.relativePath.length - name.length;
            return <button
              ref={(node) => { if (node) optionRefs.current.set(id, node); else optionRefs.current.delete(id); }}
              type="button"
              role="option"
              id={id}
              aria-selected={index === activeIndex}
              className={`quick-access-option${index === activeIndex ? " is-selected" : ""}`}
              key={file.path}
              onMouseMove={() => setSelectedOptionKey(id)}
              onClick={() => file.kind === "directory" ? void onOpenDirectory?.(file) : void onOpenFile(file)}
            >
              {file.kind === "directory" ? <ThemeIcon name="folder" size={16} aria-hidden="true" /> : <ThemeIcon name="file-code" size={16} aria-hidden="true" />}
              <span className="quick-access-option-copy"><span className="quick-access-option-label">{highlightPath(name, file.indices.filter((match) => match >= nameOffset).map((match) => match - nameOffset))}</span>{directory ? <span className="quick-access-option-detail">{highlightPath(directory, file.indices.filter((match) => match < nameOffset))}</span> : null}</span>
            </button>;
          }) : <p className="quick-access-state">{labels.noFiles}</p>}
        </> : mode === "projects" ? projectResults.length ? projectResults.map((project, index) => {
          const id = optionId("project", project.id);
          const disabled = Boolean(project.disabledReason);
          return <button
            ref={(node) => { if (node) optionRefs.current.set(id, node); else optionRefs.current.delete(id); }}
            type="button"
            role="option"
            id={id}
            aria-selected={index === activeIndex}
            aria-disabled={disabled}
            className={`quick-access-option${index === activeIndex ? " is-selected" : ""}${disabled ? " is-disabled" : ""}`}
            key={project.id}
            onMouseMove={() => setSelectedOptionKey(id)}
            onClick={() => {
              if (disabled) return;
              void onSelectProject(project);
              leaveProjectMode();
            }}
          >
            <ThemeIcon name="folder" size={16} aria-hidden="true" />
            <span className="quick-access-option-copy"><span className="quick-access-option-label">{project.label}</span><span className="quick-access-option-detail">{project.disabledReason || project.detail}</span></span>
            {project.pinned ? <ThemeIcon name="pin" size={13} aria-hidden="true" /> : null}
          </button>;
        }) : <p className="quick-access-state">{labels.noProjects}</p> : commandResults.length ? commandResults.map((command, index) => {
          const id = optionId("command", command.id);
          const disabled = Boolean(command.disabledReason);
          return <button
            ref={(node) => { if (node) optionRefs.current.set(id, node); else optionRefs.current.delete(id); }}
            type="button"
            role="option"
            id={id}
            aria-selected={index === activeIndex}
            aria-disabled={disabled}
            className={`quick-access-option${index === activeIndex ? " is-selected" : ""}${disabled ? " is-disabled" : ""}`}
            key={command.id}
            onMouseMove={() => setSelectedOptionKey(id)}
            onClick={() => { if (!disabled) void command.run(); }}
          >
            <ThemeIcon name="command" size={16} aria-hidden="true" />
            <span className="quick-access-option-copy"><span className="quick-access-option-label">{command.label}</span>{command.disabledReason || command.detail ? <span className="quick-access-option-detail">{command.disabledReason || command.detail}</span> : null}</span>
            {command.shortcut ? <kbd>{command.shortcut}</kbd> : null}
          </button>;
        }) : <p className="quick-access-state">{labels.noCommands}</p>}
      </div>
      {mode === "files" && truncated ? <div className="quick-access-limit">{labels.truncated}</div> : null}
    </section>
  </div>;
}
