import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  QuickAccess,
  fuzzyMatchPath,
  rankQuickAccessFiles,
  type QuickAccessLabels
} from "./QuickAccess";

const labels: QuickAccessLabels = {
  filePlaceholder: "Search files by path",
  commandPlaceholder: "Type a command",
  loading: "Loading",
  noFiles: "No files",
  noCommands: "No commands",
  noProject: "No project",
  truncated: "Limited",
  close: "Close",
  dialog: "Quick Access"
};

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
      commands={[]}
      recentPaths={[]}
      loading={false}
      truncated={false}
      error=""
      hasProject
      labels={labels}
      onModeChange={() => undefined}
      onQueryChange={() => undefined}
      onClose={() => undefined}
      onOpenFile={openFile}
      onOpenDirectory={openDirectory}
    />);
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
    expect(openFile).not.toHaveBeenCalled();
    expect(openDirectory).toHaveBeenCalledWith(expect.objectContaining({ path: "/work/src" }));
  });

  it("keeps the command prefix unselected while supporting keyboard execution", async () => {
    const first = vi.fn();
    const second = vi.fn();
    render(<QuickAccess
      open
      mode="commands"
      query=""
      files={[]}
      commands={[
        { id: "first", label: "First command", run: first },
        { id: "second", label: "Second command", run: second }
      ]}
      recentPaths={[]}
      loading={false}
      truncated={false}
      error=""
      hasProject
      labels={labels}
      onModeChange={() => undefined}
      onQueryChange={() => undefined}
      onClose={() => undefined}
      onOpenFile={() => undefined}
    />);
    const input = screen.getByRole("combobox") as HTMLInputElement;
    await waitFor(() => {
      expect(document.activeElement).toBe(input);
      expect(input.selectionStart).toBe(1);
      expect(input.selectionEnd).toBe(1);
    });

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
      commands={[]}
      recentPaths={[]}
      loading={false}
      truncated={false}
      error=""
      hasProject
      labels={labels}
      onModeChange={setMode}
      onQueryChange={setQuery}
      onClose={() => undefined}
      onOpenFile={() => undefined}
    />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: ">git" } });
    expect(setMode).toHaveBeenCalledWith("commands");
    expect(setQuery).toHaveBeenCalledWith("git");

    rerender(<QuickAccess open mode="commands" query="git" files={[]} commands={[]} recentPaths={[]} loading={false} truncated={false} error="" hasProject labels={labels} onModeChange={setMode} onQueryChange={setQuery} onClose={() => undefined} onOpenFile={() => undefined} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "git" } });
    expect(setMode).toHaveBeenCalledWith("files");
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
      commands: [],
      recentPaths: [],
      loading: false,
      truncated: false,
      error: "",
      hasProject: true,
      labels,
      onModeChange: () => undefined,
      onQueryChange: () => undefined,
      onClose: () => undefined,
      onOpenFile: openFile
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
      commands,
      recentPaths: [],
      loading: false,
      truncated: false,
      error: "",
      hasProject: true,
      labels,
      onModeChange: () => undefined,
      onQueryChange: () => undefined,
      onClose: () => undefined,
      onOpenFile: () => undefined
    };
    const { rerender } = render(<QuickAccess {...props} />);
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "ArrowDown" });
    rerender(<QuickAccess {...props} commands={commands.map((command) => ({ ...command }))} />);
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
  });

  it("changes pointer selection only after the mouse actually moves", () => {
    const openFile = vi.fn();
    render(<QuickAccess
      open
      mode="files"
      query=""
      files={[
        { path: "/work/one.ts", relativePath: "one.ts" },
        { path: "/work/two.ts", relativePath: "two.ts" }
      ]}
      commands={[]}
      recentPaths={[]}
      loading={false}
      truncated={false}
      error=""
      hasProject
      labels={labels}
      onModeChange={() => undefined}
      onQueryChange={() => undefined}
      onClose={() => undefined}
      onOpenFile={openFile}
    />);
    const secondOption = screen.getByRole("option", { name: /two\.ts/ });
    fireEvent.mouseEnter(secondOption);
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
    expect(openFile).toHaveBeenLastCalledWith(expect.objectContaining({ path: "/work/one.ts" }));

    fireEvent.mouseMove(secondOption);
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
    expect(openFile).toHaveBeenLastCalledWith(expect.objectContaining({ path: "/work/two.ts" }));
  });

  it("renders category headers for commands when query is empty, and hides them when filtering", () => {
    const commands = [
      { id: "nav.1", label: "Show Workbench", category: "Navigation", run: () => undefined },
      { id: "nav.2", label: "Show GTD", category: "Navigation", run: () => undefined },
      { id: "ws.1", label: "Workbench: Exit Task", category: "Workspace", run: () => undefined }
    ];
    const props = {
      open: true,
      mode: "commands" as const,
      query: "",
      files: [],
      commands,
      recentPaths: [],
      loading: false,
      truncated: false,
      error: "",
      hasProject: true,
      labels,
      onModeChange: () => undefined,
      onQueryChange: () => undefined,
      onClose: () => undefined,
      onOpenFile: () => undefined
    };
    const { rerender } = render(<QuickAccess {...props} />);
    const headers = document.querySelectorAll(".quick-access-section-header");
    expect(headers).toHaveLength(2);
    expect(headers[0].textContent).toBe("Navigation");
    expect(headers[1].textContent).toBe("Workspace");

    // When a query is typed, category headers are omitted.
    rerender(<QuickAccess {...props} query="GTD" />);
    expect(document.querySelectorAll(".quick-access-section-header")).toHaveLength(0);
    expect(screen.getByRole("option", { name: "Show GTD" })).toBeTruthy();
  });
});
