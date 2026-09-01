import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WorkbenchGitChangesPane } from "./WorkbenchGitChangesPane";

vi.mock("../../i18n", () => ({
  useI18n: () => ({ t: (key: string) => key })
}));

describe("WorkbenchGitChangesPane", () => {
  it("renders staged and unstaged files and opens a change", () => {
    const onOpenChange = vi.fn();
    render(
      <WorkbenchGitChangesPane
        hasProject
        isRepo
        staged={[{ path: "src/a.ts", repoPath: "src/a.ts", repoRoot: "/app", status: "M", staged: true, unstaged: false }]}
        unstaged={[{ path: "src/b.ts", repoPath: "src/b.ts", repoRoot: "/app", status: "?", staged: false, unstaged: true }]}
        onOpenChange={onOpenChange}
      />
    );

    fireEvent.click(screen.getByText("src/b.ts"));
    expect(onOpenChange).toHaveBeenCalledWith(expect.objectContaining({ path: "src/b.ts" }), false);
  });
});
