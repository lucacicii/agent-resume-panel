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
  workbenchRevealPath: vi.fn()
}));

vi.mock("../../bridge", () => ({ desktopApi: () => apiMocks }));
vi.mock("../../i18n", () => ({
  useI18n: () => ({ t: (key: string) => key })
}));

afterEach(() => {
  cleanup();
  apiMocks.workbenchListDirectory.mockReset();
  apiMocks.workbenchRevealPath.mockReset();
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
});
