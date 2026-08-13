import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  WorkbenchFileExplorer,
  directoryEntriesEqual,
  type WorkbenchFileExplorerHandle
} from "./WorkbenchFileExplorer";

const apiMocks = vi.hoisted(() => ({
  workbenchListDirectory: vi.fn(),
  workbenchRevealPath: vi.fn(),
  workbenchCopyPath: vi.fn(),
  workbenchClipboardHasFiles: vi.fn(),
  workbenchPastePaths: vi.fn(),
  clipboardWriteText: vi.fn()
}));

vi.mock("../../bridge", () => ({ desktopApi: () => apiMocks }));
vi.mock("../../i18n", () => ({
  useI18n: () => ({ t: (key: string) => key })
}));

afterEach(() => {
  cleanup();
  apiMocks.workbenchListDirectory.mockReset();
  apiMocks.workbenchRevealPath.mockReset();
  apiMocks.workbenchCopyPath.mockReset();
  apiMocks.workbenchClipboardHasFiles.mockReset();
  apiMocks.workbenchPastePaths.mockReset();
  apiMocks.clipboardWriteText.mockReset();
});

describe("WorkbenchFileExplorer", () => {
  it("compares cached directory entries by their stable fields", () => {
    const entries = [{ name: "src", path: "/work/app/src", isDirectory: true }];
    expect(directoryEntriesEqual(entries, entries.map((entry) => ({ ...entry })))).toBe(true);
    expect(directoryEntriesEqual(entries, [{ ...entries[0], name: "source" }])).toBe(false);
    expect(directoryEntriesEqual(undefined, entries)).toBe(false);
  });

  it("keeps directory refresh state inside the Explorer component", async () => {
    apiMocks.workbenchListDirectory.mockImplementation(async ({ dirPath }: { dirPath: string }) => ({
      entries: dirPath === "/work/app"
        ? [
            { name: "src", path: "/work/app/src", isDirectory: true },
            { name: "package.json", path: "/work/app/package.json", isDirectory: false }
          ]
        : [{ name: "index.ts", path: "/work/app/src/index.ts", isDirectory: false }]
    }));
    const explorerRef = createRef<WorkbenchFileExplorerHandle>();
    let parentRenderCount = 0;

    function Harness() {
      parentRenderCount += 1;
      return <WorkbenchFileExplorer
        ref={explorerRef}
        rootPath="/work/app"
        onOpenFile={() => undefined}
        onError={() => undefined}
      />;
    }

    render(<Harness />);
    expect(await screen.findByText("package.json")).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByText("src")); });
    expect(await screen.findByText("index.ts")).toBeTruthy();
    await waitFor(() => expect(screen.getByText("src").closest('[data-wb-entry-path="/work/app/src"]')?.getAttribute("aria-expanded")).toBe("true"));

    apiMocks.workbenchListDirectory.mockClear();
    const renderCountBeforeRefresh = parentRenderCount;
    await act(async () => { await explorerRef.current?.refresh(); });

    expect(parentRenderCount).toBe(renderCountBeforeRefresh);
    expect(apiMocks.workbenchListDirectory).toHaveBeenCalledTimes(2);
    expect(apiMocks.workbenchListDirectory).toHaveBeenCalledWith({
      rootPath: "/work/app",
      dirPath: "/work/app"
    });
    expect(apiMocks.workbenchListDirectory).toHaveBeenCalledWith({
      rootPath: "/work/app",
      dirPath: "/work/app/src"
    });
  });

  it("reveals a nested directory by expanding its ancestors and focusing it", async () => {
    apiMocks.workbenchListDirectory.mockImplementation(async ({ dirPath }: { dirPath: string }) => ({
      entries: dirPath === "/work/app"
        ? [{ name: "apps", path: "/work/app/apps", isDirectory: true }]
        : dirPath === "/work/app/apps"
          ? [{ name: "desktop", path: "/work/app/apps/desktop", isDirectory: true }]
          : []
    }));
    const explorerRef = createRef<WorkbenchFileExplorerHandle>();
    render(<WorkbenchFileExplorer
      ref={explorerRef}
      rootPath="/work/app"
      onOpenFile={() => undefined}
      onError={() => undefined}
    />);
    await screen.findByText("apps");

    await act(async () => { await explorerRef.current?.revealPath("/work/app/apps/desktop"); });

    const desktop = await screen.findByText("desktop");
    expect(desktop.closest('[data-wb-entry-path="/work/app/apps/desktop"]')).toBe(document.activeElement);
    expect(apiMocks.workbenchListDirectory).toHaveBeenCalledWith({
      rootPath: "/work/app",
      dirPath: "/work/app/apps/desktop"
    });
  });

  it("expands, scrolls to, and highlights the active editor file without stealing focus", async () => {
    const scrollIntoView = vi.fn();
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = scrollIntoView;
    apiMocks.workbenchListDirectory.mockImplementation(async ({ dirPath }: { dirPath: string }) => ({
      entries: dirPath === "/work/app"
        ? [{ name: "src", path: "/work/app/src", isDirectory: true }]
        : dirPath === "/work/app/src"
          ? [{ name: "nested", path: "/work/app/src/nested", isDirectory: true }]
          : dirPath === "/work/app/src/nested"
            ? [
                { name: "one.ts", path: "/work/app/src/nested/one.ts", isDirectory: false },
                { name: "two.ts", path: "/work/app/src/nested/two.ts", isDirectory: false }
              ]
            : []
    }));

    const { rerender } = render(<>
      <button type="button">Editor focus</button>
      <WorkbenchFileExplorer
        rootPath="/work/app"
        activePath="/work/app/src/nested/one.ts"
        onOpenFile={() => undefined}
        onError={() => undefined}
      />
    </>);
    const editorFocus = screen.getByRole("button", { name: "Editor focus" });
    editorFocus.focus();

    const firstRow = (await screen.findByText("one.ts")).closest("[role=treeitem]")!;
    await waitFor(() => expect(firstRow.getAttribute("aria-selected")).toBe("true"));
    expect(document.activeElement).toBe(editorFocus);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
    expect(apiMocks.workbenchListDirectory).not.toHaveBeenCalledWith({
      rootPath: "/work/app",
      dirPath: "/work/app/src/nested/one.ts"
    });

    rerender(<>
      <button type="button">Editor focus</button>
      <WorkbenchFileExplorer
        rootPath="/work/app"
        activePath="/work/app/src/nested/two.ts"
        onOpenFile={() => undefined}
        onError={() => undefined}
      />
    </>);

    const secondRow = (await screen.findByText("two.ts")).closest("[role=treeitem]")!;
    await waitFor(() => expect(secondRow.getAttribute("aria-selected")).toBe("true"));
    expect(firstRow.getAttribute("aria-selected")).toBe("false");
    expect(document.activeElement).toBe(editorFocus);
    HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
  });

  it("coalesces overlapping refresh requests into one queued pass", async () => {
    let release: (() => void) | undefined;
    apiMocks.workbenchListDirectory
      .mockResolvedValueOnce({ entries: [] })
      .mockImplementationOnce(() => new Promise((resolve) => {
        release = () => resolve({ entries: [] });
      }))
      .mockResolvedValue({ entries: [] });
    const explorerRef = createRef<WorkbenchFileExplorerHandle>();
    render(<WorkbenchFileExplorer
      ref={explorerRef}
      rootPath="/work/app"
      onOpenFile={() => undefined}
      onError={() => undefined}
    />);
    await waitFor(() => expect(apiMocks.workbenchListDirectory).toHaveBeenCalledTimes(1));

    const first = explorerRef.current!.refresh();
    const second = explorerRef.current!.refresh();
    expect(first).toBe(second);
    expect(apiMocks.workbenchListDirectory).toHaveBeenCalledTimes(2);

    release?.();
    await act(async () => { await first; });
    expect(apiMocks.workbenchListDirectory).toHaveBeenCalledTimes(3);
  });

  it("copies the focused file through the desktop bridge with Cmd+C", async () => {
    apiMocks.workbenchListDirectory.mockResolvedValue({
      entries: [{ name: "package.json", path: "/work/app/package.json", isDirectory: false }]
    });
    apiMocks.workbenchCopyPath.mockResolvedValue({ ok: true });

    render(<WorkbenchFileExplorer
      rootPath="/work/app"
      onOpenFile={() => undefined}
      onError={() => undefined}
    />);
    const file = await screen.findByText("package.json");
    const row = file.closest("[role=treeitem]")!;
    fireEvent.focus(row);
    fireEvent.keyDown(row, { key: "c", metaKey: true });

    await waitFor(() => expect(apiMocks.workbenchCopyPath).toHaveBeenCalledWith({
      rootPath: "/work/app",
      sourcePath: "/work/app/package.json"
    }));
  });

  it("pastes into a focused file's parent directory with Cmd+V", async () => {
    apiMocks.workbenchListDirectory.mockResolvedValue({
      entries: [{ name: "package.json", path: "/work/app/package.json", isDirectory: false }]
    });
    apiMocks.workbenchPastePaths.mockResolvedValue({ copied: [], failures: [] });

    render(<WorkbenchFileExplorer
      rootPath="/work/app"
      onOpenFile={() => undefined}
      onError={() => undefined}
    />);
    const row = (await screen.findByText("package.json")).closest("[role=treeitem]")!;
    fireEvent.focus(row);
    fireEvent.keyDown(row, { key: "v", metaKey: true });

    await waitFor(() => expect(apiMocks.workbenchPastePaths).toHaveBeenCalledWith({
      rootPath: "/work/app",
      targetDirectory: "/work/app"
    }));
  });

  it("offers copy, copy path, paste, and Finder reveal from the file context menu", async () => {
    apiMocks.workbenchListDirectory.mockResolvedValue({
      entries: [{ name: "package.json", path: "/work/app/package.json", isDirectory: false }]
    });
    apiMocks.workbenchClipboardHasFiles.mockResolvedValue({ hasFiles: true });

    render(<WorkbenchFileExplorer
      rootPath="/work/app"
      onOpenFile={() => undefined}
      onError={() => undefined}
    />);
    const row = (await screen.findByText("package.json")).closest("[role=treeitem]")!;
    fireEvent.contextMenu(row, { clientX: 20, clientY: 30 });

    expect(await screen.findByRole("menuitem", { name: "desktop.common.copy" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "desktop.common.copyPath" })).toBeTruthy();
    await waitFor(() => expect((screen.getByRole("menuitem", {
      name: "desktop.common.paste"
    }) as HTMLButtonElement).disabled).toBe(false));
    expect(screen.getByRole("menuitem", { name: "desktop.workbench.explorerRevealInFinder" })).toBeTruthy();
  });

  it("offers Git file history only for files and passes the absolute path", async () => {
    apiMocks.workbenchListDirectory.mockResolvedValue({
      entries: [
        { name: "src", path: "/work/app/src", isDirectory: true },
        { name: "package.json", path: "/work/app/package.json", isDirectory: false }
      ]
    });
    apiMocks.workbenchClipboardHasFiles.mockResolvedValue({ hasFiles: false });
    const onShowGitHistory = vi.fn();

    render(<WorkbenchFileExplorer
      rootPath="/work/app"
      onOpenFile={() => undefined}
      onShowGitHistory={onShowGitHistory}
      onError={() => undefined}
    />);

    const directoryRow = (await screen.findByText("src")).closest("[role=treeitem]")!;
    fireEvent.contextMenu(directoryRow, { clientX: 20, clientY: 30 });
    expect(screen.queryByRole("menuitem", { name: "desktop.workbench.explorerGitFileHistory" })).toBeNull();

    const fileRow = screen.getByText("package.json").closest("[role=treeitem]")!;
    fireEvent.contextMenu(fileRow, { clientX: 20, clientY: 30 });
    fireEvent.click(screen.getByRole("menuitem", { name: "desktop.workbench.explorerGitFileHistory" }));

    expect(onShowGitHistory).toHaveBeenCalledWith("/work/app/package.json");
    expect(screen.queryByRole("menuitem", { name: "desktop.workbench.explorerGitFileHistory" })).toBeNull();
  });

  it("offers Preview only for Markdown file labels and opens them in preview mode", async () => {
    apiMocks.workbenchListDirectory.mockResolvedValue({
      entries: [
        { name: "src", path: "/work/app/src", isDirectory: true },
        { name: "README.md", path: "/work/app/README.md", isDirectory: false },
        { name: "package.json", path: "/work/app/package.json", isDirectory: false }
      ]
    });
    apiMocks.workbenchClipboardHasFiles.mockResolvedValue({ hasFiles: false });
    const onOpenPreview = vi.fn();

    render(<WorkbenchFileExplorer
      rootPath="/work/app"
      onOpenFile={() => undefined}
      onOpenPreview={onOpenPreview}
      onError={() => undefined}
    />);

    // Directories and non-Markdown files never offer Preview.
    const directoryRow = (await screen.findByText("src")).closest("[role=treeitem]")!;
    fireEvent.contextMenu(directoryRow, { clientX: 20, clientY: 30 });
    expect(screen.queryByRole("menuitem", { name: "desktop.workbench.preview" })).toBeNull();
    fireEvent.keyDown(window, { key: "Escape" });

    const fileRow = screen.getByText("package.json").closest("[role=treeitem]")!;
    fireEvent.contextMenu(fileRow, { clientX: 20, clientY: 30 });
    expect(screen.queryByRole("menuitem", { name: "desktop.workbench.preview" })).toBeNull();
    fireEvent.keyDown(window, { key: "Escape" });

    // Right-clicking the Markdown file label exposes Preview and opens it in preview mode.
    const markdownLabel = screen.getByText("README.md");
    fireEvent.contextMenu(markdownLabel, { clientX: 20, clientY: 30 });
    fireEvent.click(await screen.findByRole("menuitem", { name: "desktop.workbench.preview" }));

    expect(onOpenPreview).toHaveBeenCalledWith("/work/app/README.md");
    expect(screen.queryByRole("menuitem", { name: "desktop.workbench.preview" })).toBeNull();
  });

  it("copies absolute file and directory paths as text from the context menu", async () => {
    apiMocks.workbenchListDirectory.mockResolvedValue({
      entries: [
        { name: "src", path: "/work/app/src", isDirectory: true },
        { name: "package.json", path: "/work/app/package.json", isDirectory: false }
      ]
    });
    apiMocks.workbenchClipboardHasFiles.mockResolvedValue({ hasFiles: false });

    render(<WorkbenchFileExplorer
      rootPath="/work/app"
      onOpenFile={() => undefined}
      onError={() => undefined}
    />);

    const directoryRow = (await screen.findByText("src")).closest("[role=treeitem]")!;
    fireEvent.contextMenu(directoryRow, { clientX: 20, clientY: 30 });
    fireEvent.click(screen.getByRole("menuitem", { name: "desktop.common.copyPath" }));
    expect(apiMocks.clipboardWriteText).toHaveBeenLastCalledWith("/work/app/src");

    const fileRow = screen.getByText("package.json").closest("[role=treeitem]")!;
    fireEvent.contextMenu(fileRow, { clientX: 20, clientY: 30 });
    fireEvent.click(screen.getByRole("menuitem", { name: "desktop.common.copyPath" }));
    expect(apiMocks.clipboardWriteText).toHaveBeenLastCalledWith("/work/app/package.json");
  });
});
