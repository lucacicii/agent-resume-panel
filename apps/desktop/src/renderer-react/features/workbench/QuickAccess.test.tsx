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

  it("matches directory entries using relative, absolute, and backslash path fragments", () => {
    const entries = [
      { path: "/work/app/apps/desktop", relativePath: "apps/desktop", kind: "directory" as const },
      { path: "/work/app/apps/desktop/src/main.ts", relativePath: "apps/desktop/src/main.ts", kind: "file" as const }
    ];
    expect(rankQuickAccessFiles(entries, "apps/des")[0]).toMatchObject({ relativePath: "apps/desktop", kind: "directory" });
    expect(rankQuickAccessFiles(entries, "/work/app/apps/desktop")[0]).toMatchObject({ relativePath: "apps/desktop", kind: "directory" });
    expect(rankQuickAccessFiles(entries, "apps\\desktop")[0]).toMatchObject({ relativePath: "apps/desktop", kind: "directory" });
  });

  it("keeps directories out of the default recent-file view", () => {
    const entries = [
      { path: "/work/src", relativePath: "src", kind: "directory" as const },
      { path: "/work/src/main.ts", relativePath: "src/main.ts", kind: "file" as const }
    ];
    expect(rankQuickAccessFiles(entries, "")).toEqual([
      expect.objectContaining({ relativePath: "src/main.ts" })
    ]);
  });

  it("activates a matched directory separately from files", () => {
    const openFile = vi.fn();
    const openDirectory = vi.fn();
    render(<QuickAccess
      open
      mode="files"
      query="src"
      files={[{ path: "/work/src", relativePath: "src", kind: "directory" }]}
      projects={[]}
      commands={[]}
      recentPaths={[]}
      loading={false}
      truncated={false}
      error=""
      projectLabel="Project"
      currentProjectPath="/work"
      labels={labels}
      onModeChange={() => undefined}
      onQueryChange={() => undefined}
      onClose={() => undefined}
      onOpenFile={openFile}
      onOpenDirectory={openDirectory}
      onSelectProject={() => undefined}
    />);
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
    expect(openFile).not.toHaveBeenCalled();
    expect(openDirectory).toHaveBeenCalledWith(expect.objectContaining({ path: "/work/src" }));
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

  it("keeps the selected project across recreated and reordered result arrays", () => {
    const selectProject = vi.fn();
    const props = {
      open: true,
      mode: "projects" as const,
      query: "",
      files: [],
      projects: sampleProjects,
      commands: [],
      recentPaths: [],
      loading: false,
      truncated: false,
      error: "",
      projectLabel: "One — /work/one",
      currentProjectPath: "/work/one",
      labels,
      onModeChange: () => undefined,
      onQueryChange: () => undefined,
      onClose: () => undefined,
      onOpenFile: () => undefined,
      onSelectProject: selectProject
    };
    const { rerender } = render(<QuickAccess {...props} />);
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "ArrowDown" });
    expect(screen.getByRole("option", { name: /Two/ }).getAttribute("aria-selected")).toBe("true");

    const reordered = [sampleProjects[1], sampleProjects[0]].map((project) => ({ ...project }));
    rerender(<QuickAccess {...props} projects={reordered} />);
    expect(screen.getByRole("option", { name: /Two/ }).getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
    expect(selectProject).toHaveBeenCalledWith(expect.objectContaining({ id: "two" }));
  });

  it("falls back to the first project only when the selected project disappears", () => {
    const props = {
      open: true,
      mode: "projects" as const,
      query: "",
      files: [],
      projects: sampleProjects,
      commands: [],
      recentPaths: [],
      loading: false,
      truncated: false,
      error: "",
      projectLabel: "One — /work/one",
      currentProjectPath: "/work/one",
      labels,
      onModeChange: () => undefined,
      onQueryChange: () => undefined,
      onClose: () => undefined,
      onOpenFile: () => undefined,
      onSelectProject: () => undefined
    };
    const { rerender } = render(<QuickAccess {...props} />);
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "ArrowDown" });
    rerender(<QuickAccess {...props} projects={[{ ...sampleProjects[0] }]} />);
    expect(screen.getByRole("option", { name: /One/ }).getAttribute("aria-selected")).toBe("true");
  });

  it("keeps file selection when the parent recreates file results", () => {
    const openFile = vi.fn();
    const files = [
      { path: "/work/one.ts", relativePath: "one.ts" },
      { path: "/work/two.ts", relativePath: "two.ts" }
    ];
    const props = {
      open: true,
      mode: "files" as const,
      query: "",
      files,
      projects: [],
      commands: [],
      recentPaths: [],
      loading: false,
      truncated: false,
      error: "",
      projectLabel: "Project",
      currentProjectPath: "/work",
      labels,
      onModeChange: () => undefined,
      onQueryChange: () => undefined,
      onClose: () => undefined,
      onOpenFile: openFile,
      onSelectProject: () => undefined
    };
    const { rerender } = render(<QuickAccess {...props} />);
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "ArrowDown" });
    rerender(<QuickAccess {...props} files={files.map((file) => ({ ...file }))} />);
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
    expect(openFile).toHaveBeenCalledWith(expect.objectContaining({ path: "/work/two.ts" }));
  });

  it("keeps command selection when the parent recreates command results", () => {
    const first = vi.fn();
    const second = vi.fn();
    const commands = [
      { id: "first", label: "First command", run: first },
      { id: "second", label: "Second command", run: second }
    ];
    const props = {
      open: true,
      mode: "commands" as const,
      query: "",
      files: [],
      projects: [],
      commands,
      recentPaths: [],
      loading: false,
      truncated: false,
      error: "",
      projectLabel: "Project",
      currentProjectPath: "",
      labels,
      onModeChange: () => undefined,
      onQueryChange: () => undefined,
      onClose: () => undefined,
      onOpenFile: () => undefined,
      onSelectProject: () => undefined
    };
    const { rerender } = render(<QuickAccess {...props} />);
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "ArrowDown" });
    rerender(<QuickAccess {...props} commands={commands.map((command) => ({ ...command }))} />);
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
  });

  it("changes pointer selection only after the mouse actually moves", () => {
    const selectProject = vi.fn();
    render(<QuickAccess
      open
      mode="projects"
      query=""
      files={[]}
      projects={sampleProjects}
      commands={[]}
      recentPaths={[]}
      loading={false}
      truncated={false}
      error=""
      projectLabel="Project"
      currentProjectPath="/work/one"
      labels={labels}
      onModeChange={() => undefined}
      onQueryChange={() => undefined}
      onClose={() => undefined}
      onOpenFile={() => undefined}
      onSelectProject={selectProject}
    />);
    const secondOption = screen.getByRole("option", { name: /Two/ });
    fireEvent.mouseEnter(secondOption);
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
    expect(selectProject).toHaveBeenLastCalledWith(expect.objectContaining({ id: "one" }));

    fireEvent.mouseMove(secondOption);
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
    expect(selectProject).toHaveBeenLastCalledWith(expect.objectContaining({ id: "two" }));
  });
});
