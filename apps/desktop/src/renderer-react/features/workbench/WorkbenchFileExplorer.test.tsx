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
  workbenchPastePaths: vi.fn()
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
    fireEvent.click(screen.getByText("src"));
    expect(await screen.findByText("index.ts")).toBeTruthy();

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

  it("offers copy, paste, and Finder reveal from the file context menu", async () => {
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
    await waitFor(() => expect((screen.getByRole("menuitem", {
      name: "desktop.common.paste"
    }) as HTMLButtonElement).disabled).toBe(false));
    expect(screen.getByRole("menuitem", { name: "desktop.workbench.explorerRevealInFinder" })).toBeTruthy();
  });
});
