import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WorkbenchSearchPane } from "./WorkbenchSearchPane";

vi.mock("../../i18n", () => ({
  useI18n: () => ({ t: (key: string, ...args: Array<string | number>) => [key, ...args].join(" ") })
}));

describe("WorkbenchSearchPane", () => {
  it("groups matches and opens a selected hit", () => {
    const onOpenMatch = vi.fn();
    render(
      <WorkbenchSearchPane
        hasProject
        query="value"
        onQueryChange={() => undefined}
        onSubmit={() => undefined}
        matchCase={false}
        wholeWord={false}
        useRegex={false}
        onToggleMatchCase={() => undefined}
        onToggleWholeWord={() => undefined}
        onToggleUseRegex={() => undefined}
        loading={false}
        error=""
        truncated={false}
        matches={[
          { path: "/app/a.ts", relativePath: "a.ts", line: 2, column: 1, endColumn: 6, preview: "value one" },
          { path: "/app/a.ts", relativePath: "a.ts", line: 8, column: 1, endColumn: 6, preview: "value two" }
        ]}
        selectedKey=""
        onOpenMatch={onOpenMatch}
      />
    );

    fireEvent.click(screen.getByText("value two"));
    expect(onOpenMatch).toHaveBeenCalledWith(expect.objectContaining({ path: "/app/a.ts", line: 8 }));
  });
});
