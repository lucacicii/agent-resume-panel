import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  QuickAccess,
  fuzzyMatchPath,
  rankQuickAccessFiles,
  type QuickAccessLabels,
  type QuickAccessMode,
  type QuickAccessProject
} from "./QuickAccess";

const labels: QuickAccessLabels = {
  filePlaceholder: "Search files by path",
  projectPlaceholder: "Search projects",
  commandPlaceholder: "Type a command",
  loading: "Loading",
  noFiles: "No files",
  noProjects: "No projects",
  noCommands: "No commands",
  noProject: "No project",
  truncated: "Limited",
  close: "Close",
  dialog: "Quick Access",
  selectProject: "Select project"
};

const sampleProjects: QuickAccessProject[] = [
  { id: "one", path: "/work/one", label: "One", detail: "/work/one", pinned: true },
  { id: "two", path: "/work/two", label: "Two", detail: "/work/two" }
];

function ControlledQuickAccess({
  initialQuery = "",
  initialMode = "files",
  projects = sampleProjects,
  currentProjectPath = "/work/one",
  onSelectProject = () => undefined,
  onClose = () => undefined
}: {
  initialQuery?: string;
  initialMode?: QuickAccessMode;
  projects?: QuickAccessProject[];
  currentProjectPath?: string;
  onSelectProject?: (project: QuickAccessProject) => void;
  onClose?: () => void;
}) {
  const [mode, setMode] = useState<QuickAccessMode>(initialMode);
  const [query, setQuery] = useState(initialQuery);
  return <QuickAccess
    open
    mode={mode}
    query={query}
    files={[]}
    projects={projects}
    commands={[]}
    recentPaths={[]}
    loading={false}
    truncated={false}
    error=""
    projectLabel="One — /work/one"
    currentProjectPath={currentProjectPath}
    labels={labels}
    onModeChange={setMode}
    onQueryChange={setQuery}
    onClose={onClose}
    onOpenFile={() => undefined}
    onSelectProject={onSelectProject}
  />;
}

afterEach(cleanup);

describe("QuickAccess", () => {
  it("ranks exact basenames and fuzzy abbreviations", () => {
    const files = [
      { path: "/work/src/WorkbenchPanel.tsx", relativePath: "src/WorkbenchPanel.tsx" },
      { path: "/work/docs/workbench-panel.md", relativePath: "docs/workbench-panel.md" },
      { path: "/work/src/panel.ts", relativePath: "src/panel.ts" }
    ];
    expect(fuzzyMatchPath("src/WorkbenchPanel.tsx", "wbpnl")).not.toBeNull();
    expect(rankQuickAccessFiles(files, "panel.ts")[0].relativePath).toBe("src/panel.ts");
    expect(rankQuickAccessFiles(files, "wbpnl")[0].relativePath).toBe("src/WorkbenchPanel.tsx");
  });

  it("puts recent files first for an empty query", () => {
    const files = [
      { path: "/work/a.ts", relativePath: "a.ts" },
      { path: "/work/z.ts", relativePath: "z.ts" }
    ];
    expect(rankQuickAccessFiles(files, "", ["/work/z.ts"])[0].path).toBe("/work/z.ts");
  });

  it("supports keyboard selection and command execution", () => {
    const first = vi.fn();
    const second = vi.fn();
    render(<QuickAccess
      open
      mode="commands"
      query=""
      files={[]}
      projects={[]}
      recentPaths={[]}
      loading={false}
      truncated={false}
      error=""
      projectLabel="Project"
      currentProjectPath=""
      labels={labels}
      commands={[
        { id: "first", label: "First command", run: first },
        { id: "second", label: "Second command", run: second }
      ]}
      onModeChange={() => undefined}
      onQueryChange={() => undefined}
      onClose={() => undefined}
      onOpenFile={() => undefined}
      onSelectProject={() => undefined}
    />);
    const input = screen.getByRole("combobox");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
  });

  it("switches between command and file mode using the prefix", () => {
    const setMode = vi.fn();
    const setQuery = vi.fn();
    const { rerender } = render(<QuickAccess
      open
      mode="files"
      query=""
      files={[]}
      projects={[]}
      commands={[]}
      recentPaths={[]}
      loading={false}
      truncated={false}
      error=""
      projectLabel="Project"
      currentProjectPath=""
      labels={labels}
      onModeChange={setMode}
      onQueryChange={setQuery}
      onClose={() => undefined}
      onOpenFile={() => undefined}
      onSelectProject={() => undefined}
    />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: ">git" } });
    expect(setMode).toHaveBeenCalledWith("commands");
    expect(setQuery).toHaveBeenCalledWith("git");

    rerender(<QuickAccess open mode="commands" query="git" files={[]} projects={[]} commands={[]} recentPaths={[]} loading={false} truncated={false} error="" projectLabel="Project" currentProjectPath="" labels={labels} onModeChange={setMode} onQueryChange={setQuery} onClose={() => undefined} onOpenFile={() => undefined} onSelectProject={() => undefined} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "git" } });
    expect(setMode).toHaveBeenCalledWith("files");
  });

  it("opens project selection with ArrowLeft only when the caret is at the start", () => {
    render(<ControlledQuickAccess initialQuery="src" />);
    const input = screen.getByRole("combobox") as HTMLInputElement;
    input.setSelectionRange(2, 2);
    fireEvent.keyDown(input, { key: "ArrowLeft" });
    expect(input.placeholder).toBe(labels.filePlaceholder);

    input.setSelectionRange(0, 0);
    fireEvent.keyDown(input, { key: "ArrowLeft" });
    expect(screen.getByRole("combobox")).toHaveProperty("placeholder", labels.projectPlaceholder);
    expect(screen.getByRole("option", { name: /One/ }).getAttribute("aria-selected")).toBe("true");
  });

  it("does not replace a selected file query with project selection", () => {
    render(<ControlledQuickAccess initialQuery="src" />);
    const input = screen.getByRole("combobox") as HTMLInputElement;
    input.setSelectionRange(0, 3);
    fireEvent.keyDown(input, { key: "ArrowLeft" });
    expect(input.placeholder).toBe(labels.filePlaceholder);
  });

  it("selects another project and restores the file query", () => {
    const selectProject = vi.fn();
    render(<ControlledQuickAccess initialQuery="src" onSelectProject={selectProject} />);
    const input = screen.getByRole("combobox") as HTMLInputElement;
    input.setSelectionRange(0, 0);
    fireEvent.keyDown(input, { key: "ArrowLeft" });
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "ArrowDown" });
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
    expect(selectProject).toHaveBeenCalledWith(sampleProjects[1]);
    expect((screen.getByRole("combobox") as HTMLInputElement).value).toBe("src");
  });

  it("returns to file search on Escape without closing Quick Access", () => {
    const close = vi.fn();
    render(<ControlledQuickAccess initialQuery="src" onClose={close} />);
    const input = screen.getByRole("combobox") as HTMLInputElement;
    input.setSelectionRange(0, 0);
    fireEvent.keyDown(input, { key: "ArrowLeft" });
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Escape" });
    expect(close).not.toHaveBeenCalled();
    expect((screen.getByRole("combobox") as HTMLInputElement).value).toBe("src");
  });

  it("filters projects by path and does not activate a missing project", () => {
    const selectProject = vi.fn();
    const projects = [
      ...sampleProjects,
      { id: "missing", path: "/gone/app", label: "Missing", detail: "/gone/app", disabledReason: "Path missing" }
    ];
    render(<ControlledQuickAccess projects={projects} onSelectProject={selectProject} />);
    const input = screen.getByRole("combobox") as HTMLInputElement;
    input.setSelectionRange(0, 0);
    fireEvent.keyDown(input, { key: "ArrowLeft" });
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "gone" } });
    expect(screen.getAllByRole("option")).toHaveLength(1);
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
    expect(selectProject).not.toHaveBeenCalled();
    expect((screen.getByRole("combobox") as HTMLInputElement).value).toBe("gone");
  });
});
