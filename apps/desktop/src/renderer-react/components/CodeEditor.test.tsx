import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CodeEditor, getFloatingMenuPosition, type CodeEditorHandle } from "./CodeEditor";

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn(() => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn()
  }))
});

Object.defineProperty(Range.prototype, "getClientRects", {
  writable: true,
  value: () => []
});

Object.defineProperty(Range.prototype, "getBoundingClientRect", {
  writable: true,
  value: () => ({ bottom: 0, height: 0, left: 0, right: 0, top: 0, width: 0 })
});

afterEach(() => cleanup());

const statuses = ["inbox", "next", "waiting", "someday", "reference", "done"];
const commands = statuses.map((status) => {
  const opener = ":::gtd " + status;
  return {
    label: "GTD task",
    tag: { label: "@GTD/" + status, toneClassName: "is-" + status },
    insert: opener + "\n\n:::",
    cursorOffset: opener.length + 1
  };
});

describe("CodeEditor slash commands", () => {
  it("opens below the cursor when there is enough room", () => {
    expect(getFloatingMenuPosition(
      { left: 100, top: 100, bottom: 120 },
      { width: 220, height: 248 },
      { width: 1_120, height: 800 }
    )).toEqual({ left: 100, top: 124 });
  });

  it("keeps the menu within the viewport and opens upward near the bottom edge", () => {
    expect(getFloatingMenuPosition(
      { left: 1_080, top: 730, bottom: 750 },
      { width: 220, height: 248 },
      { width: 1_120, height: 800 }
    )).toEqual({ left: 892, top: 478 });
  });

  it("keeps the preferred below-cursor position within a narrow viewport", () => {
    expect(getFloatingMenuPosition(
      { left: 95, top: 40, bottom: 60 },
      { width: 220, height: 248 },
      { width: 100, height: 300 }
    )).toEqual({ left: 8, top: 44 });
  });

  it("cycles through tagged commands and inserts the selected GTD block", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { container } = render(
      <CodeEditor value="" ariaLabel="Markdown editor" onChange={onChange} slashCommands={commands} />
    );

    const editor = container.querySelector(".cm-content") as HTMLElement;
    await user.click(editor);
    await user.keyboard("/");
    const options = await screen.findAllByRole("option");
    expect(options).toHaveLength(6);
    expect(options[0].getAttribute("aria-selected")).toBe("true");

    await user.keyboard("{ArrowDown}{ArrowDown}");
    expect(screen.getAllByRole("option")[2].getAttribute("aria-selected")).toBe("true");
    await user.keyboard("{ArrowUp}{ArrowUp}{ArrowUp}");
    expect(screen.getAllByRole("option")[5].getAttribute("aria-selected")).toBe("true");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith(":::gtd done\n\n:::"));
  });

  it("closes the slash menu when Escape is pressed", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <CodeEditor value="" ariaLabel="Markdown editor" onChange={vi.fn()} slashCommands={commands} />
    );

    await user.click(container.querySelector(".cm-content") as HTMLElement);
    await user.keyboard("/");
    expect(await screen.findAllByRole("option")).toHaveLength(6);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("option")).toBeNull();
  });
});

describe("CodeEditor search sessions", () => {
  it("decorates every match, tracks the current match, and wraps navigation", () => {
    const ref = createRef<CodeEditorHandle>();
    const { container } = render(
      <CodeEditor ref={ref} value="Alpha alpha ALPHA" ariaLabel="Markdown editor" onChange={vi.fn()} />
    );

    let result = { current: 0, total: 0 };
    act(() => { result = ref.current?.setSearchQuery("alpha") || result; });
    expect(result).toEqual({ current: 1, total: 3 });
    expect(container.querySelectorAll(".cm-editor-search-match")).toHaveLength(3);
    expect(container.querySelectorAll(".cm-editor-search-match-current")).toHaveLength(1);

    act(() => { result = ref.current?.navigateSearch("backward") || result; });
    expect(result).toEqual({ current: 3, total: 3 });
    act(() => { result = ref.current?.navigateSearch("forward") || result; });
    expect(result).toEqual({ current: 1, total: 3 });

    act(() => ref.current?.clearSearch());
    expect(ref.current?.getSearchResult()).toEqual({ current: 0, total: 0 });
    expect(container.querySelector(".cm-editor-search-match")).toBeNull();
  });

  it("uses an exact editor selection as the current prefilled match", () => {
    const ref = createRef<CodeEditorHandle>();
    render(<CodeEditor ref={ref} value="value value value" ariaLabel="Markdown editor" onChange={vi.fn()} />);

    act(() => ref.current?.revealRange({ line: 1, column: 7, endColumn: 12, focus: false }));
    expect(ref.current?.getSelectedText()).toBe("value");
    expect(ref.current?.setSearchQuery("value")).toEqual({ current: 2, total: 3 });
  });
});
