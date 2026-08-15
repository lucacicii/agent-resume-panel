import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { forwardRef, useImperativeHandle } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkbenchDiffView } from "./WorkbenchDiffView";

vi.stubGlobal("matchMedia", () => ({
  matches: false,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn()
}));

vi.mock("../../i18n", () => ({
  useI18n: () => ({
    t: (key: string, ...args: unknown[]) => args.length ? `${key}:${args.join(",")}` : key
  })
}));

vi.mock("../../components/ThemeIcon", () => ({
  ThemeIcon: ({ name }: { name: string }) => <span data-icon={name} />
}));

vi.mock("../../bridge", () => ({
  desktopApi: () => ({
    clipboardWriteText: vi.fn(),
    clipboardReadText: vi.fn(() => "")
  })
}));

vi.mock("@pierre/diffs", () => ({
  parseDiffFromFile: vi.fn((oldFile: { name: string; cacheKey: string } | null, newFile: { name: string; cacheKey: string } | null) => ({
    testFileName: newFile?.name || oldFile?.name,
    testCacheKey: newFile?.cacheKey || oldFile?.cacheKey,
    hunks: [{
      additionStart: 1,
      additionCount: 2,
      deletionStart: 1,
      deletionCount: 2,
      hunkSpecs: "@@ -1,2 +1,2 @@"
    }]
  }))
}));

vi.mock("@pierre/diffs/react", () => ({
  CodeView: forwardRef(({ items, options, onSelectedLinesChange, renderGutterUtility }: {
    items?: ReadonlyArray<{
      id: string;
      version?: number;
      fileDiff?: { testFileName?: string; testCacheKey?: string };
    }>;
    options?: {
      diffStyle?: string;
      overflow?: string;
      enableGutterUtility?: boolean;
      onLineEnter?: (line: { lineType: string }) => void;
      onLineLeave?: () => void;
    };
    onSelectedLinesChange?: (selection: unknown) => void;
    renderGutterUtility?: (
      getHoveredLine: () => { lineNumber: number; side: "additions" | "deletions" },
      item: unknown
    ) => React.ReactNode;
  }, ref) => {
    useImperativeHandle(ref, () => ({ scrollTo: vi.fn() }));
    const item = items?.[0];
    return <div
      data-testid="code-view"
      data-mode={options?.diffStyle}
      data-overflow={options?.overflow}
      data-item-id={item?.id}
      data-item-version={item?.version}
      data-file-name={item?.fileDiff?.testFileName}
      data-cache-key={item?.fileDiff?.testCacheKey}
    >
      {renderGutterUtility?.(() => ({ lineNumber: 2, side: "additions" }), item)}
      <button type="button" onClick={() => options?.onLineEnter?.({ lineType: "change-addition" })}>hover changed line</button>
      <button type="button" onClick={() => options?.onLineEnter?.({ lineType: "context" })}>hover context line</button>
      <button type="button" onClick={() => options?.onLineLeave?.()}>leave line</button>
      <button type="button" onClick={() => onSelectedLinesChange?.({ id: item?.id, range: { start: 1, end: 1, side: "additions" } })}>select hunk</button>
    </div>;
  })
}));

describe("WorkbenchDiffView", () => {
  afterEach(() => cleanup());

  const diff = {
    key: "diff:fixture",
    path: "src/example.ts",
    repoRoot: "/repo",
    repoPath: "src/example.ts",
    source: "working-tree" as const,
    oldLabel: "HEAD",
    newLabel: "Working Tree",
    oldText: "const value = 1;\n",
    newText: "const value = 2;\n"
  };

  it("switches between split and unified rendering", () => {
    render(<WorkbenchDiffView diff={diff} appearance="light" />);
    expect(screen.getByTestId("code-view").getAttribute("data-mode")).toBe("split");
    expect(screen.getByTestId("code-view").getAttribute("data-overflow")).toBe("scroll");
    fireEvent.click(screen.getByRole("button", { name: "desktop.workbench.diffUnified" }));
    expect(screen.getByTestId("code-view").getAttribute("data-mode")).toBe("unified");
  });

  it("exposes the selected hunk to the discard callback", () => {
    const onDiscardHunk = vi.fn();
    render(<WorkbenchDiffView diff={diff} appearance="light" onDiscardHunk={onDiscardHunk} />);
    fireEvent.click(screen.getByRole("button", { name: "select hunk" }));
    fireEvent.click(screen.getByRole("button", { name: "desktop.workbench.gitDiscardHunk" }));
    expect(onDiscardHunk).toHaveBeenCalledWith({
      oldStart: 1,
      oldLines: 2,
      newStart: 1,
      newLines: 2
    });
  });

  it("stages the selected working-tree hunk", () => {
    const onStageHunk = vi.fn();
    render(<WorkbenchDiffView diff={diff} appearance="light" onStageHunk={onStageHunk} />);
    fireEvent.click(screen.getByRole("button", { name: "select hunk" }));
    fireEvent.click(screen.getByRole("button", { name: "desktop.workbench.gitStageHunk" }));
    expect(onStageHunk).toHaveBeenCalledWith({
      oldStart: 1,
      oldLines: 2,
      newStart: 1,
      newLines: 2
    });
  });

  it("unstages the selected staged hunk", () => {
    const onUnstageHunk = vi.fn();
    render(<WorkbenchDiffView
      diff={{ ...diff, source: "staged", newLabel: "Staged" }}
      appearance="light"
      onUnstageHunk={onUnstageHunk}
    />);
    fireEvent.click(screen.getByRole("button", { name: "select hunk" }));
    fireEvent.click(screen.getByRole("button", { name: "desktop.workbench.gitUnstageHunk" }));
    expect(onUnstageHunk).toHaveBeenCalledWith({
      oldStart: 1,
      oldLines: 2,
      newStart: 1,
      newLines: 2
    });
  });

  it("does not show stage action for staged diffs", () => {
    render(<WorkbenchDiffView
      diff={{ ...diff, source: "staged", newLabel: "Staged" }}
      appearance="light"
      onStageHunk={vi.fn()}
    />);
    fireEvent.click(screen.getByRole("button", { name: "select hunk" }));
    expect(screen.queryByRole("button", { name: "desktop.workbench.gitStageHunk" })).toBeNull();
  });

  it("publishes a fresh CodeView item when the active diff changes", () => {
    const { rerender } = render(<WorkbenchDiffView diff={diff} appearance="light" />);
    const first = screen.getByTestId("code-view");
    const firstVersion = first.getAttribute("data-item-version");
    const firstCacheKey = first.getAttribute("data-cache-key");
    expect(first.getAttribute("data-item-id")).toBe("diff:fixture");
    expect(first.getAttribute("data-file-name")).toBe("src/example.ts");

    rerender(<WorkbenchDiffView diff={{
      ...diff,
      key: "diff:second",
      path: "src/second.ts",
      newText: "const second = true;\n"
    }} appearance="light" />);

    const second = screen.getByTestId("code-view");
    expect(second.getAttribute("data-item-id")).toBe("diff:second");
    expect(second.getAttribute("data-file-name")).toBe("src/second.ts");
    expect(second.getAttribute("data-item-version")).not.toBe(firstVersion);
    expect(second.getAttribute("data-cache-key")).not.toBe(firstCacheKey);
  });

  it("bumps the CodeView item version when the same diff is refreshed", () => {
    const { rerender } = render(<WorkbenchDiffView diff={diff} appearance="light" />);
    const firstVersion = screen.getByTestId("code-view").getAttribute("data-item-version");
    const firstCacheKey = screen.getByTestId("code-view").getAttribute("data-cache-key");

    rerender(<WorkbenchDiffView diff={{ ...diff, newText: "const value = 3;\n" }} appearance="light" />);

    expect(screen.getByTestId("code-view").getAttribute("data-item-id")).toBe("diff:fixture");
    expect(screen.getByTestId("code-view").getAttribute("data-item-version")).not.toBe(firstVersion);
    expect(screen.getByTestId("code-view").getAttribute("data-cache-key")).not.toBe(firstCacheKey);
  });

  it("shows an IDEA-style gutter rollback action only on changed lines", () => {
    const onDiscardLine = vi.fn();
    render(<WorkbenchDiffView diff={diff} appearance="light" onDiscardLine={onDiscardLine} />);
    const rollback = document.querySelector<HTMLButtonElement>(".wb-diff-line-discard-btn")!;
    expect(rollback.hidden).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "hover changed line" }));
    expect(rollback.hidden).toBe(false);
    fireEvent.click(rollback);
    expect(onDiscardLine).toHaveBeenCalledWith({ side: "additions", lineNumber: 2 });

    fireEvent.click(screen.getByRole("button", { name: "hover context line" }));
    expect(rollback.hidden).toBe(true);
  });

  it("shows a stage gutter action for working-tree line changes", () => {
    const onStageLine = vi.fn();
    render(<WorkbenchDiffView diff={diff} appearance="light" onStageLine={onStageLine} />);
    const stage = document.querySelector<HTMLButtonElement>(".wb-diff-line-stage-btn")!;
    expect(stage.hidden).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "hover changed line" }));
    expect(stage.hidden).toBe(false);
    fireEvent.click(stage);
    expect(onStageLine).toHaveBeenCalledWith({ side: "additions", lineNumber: 2 });
  });

  it("shows an unstage gutter action for staged line changes", () => {
    const onUnstageLine = vi.fn();
    render(<WorkbenchDiffView
      diff={{ ...diff, source: "staged", newLabel: "Staged" }}
      appearance="light"
      onUnstageLine={onUnstageLine}
    />);
    const unstage = document.querySelector<HTMLButtonElement>(".wb-diff-line-stage-btn")!;
    fireEvent.click(screen.getByRole("button", { name: "hover changed line" }));
    expect(unstage.hidden).toBe(false);
    fireEvent.click(unstage);
    expect(onUnstageLine).toHaveBeenCalledWith({ side: "additions", lineNumber: 2 });
  });
});
