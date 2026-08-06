import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CodeEditor, type CodeEditorHandle } from "./CodeEditor";
import { resolveCodeMirrorThemeId } from "./codeMirrorThemes";

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

afterEach(() => {
  cleanup();
  delete document.documentElement.dataset.visualTheme;
  delete document.documentElement.dataset.theme;
});

describe("CodeEditor visual themes", () => {
  it("resolves Cyberpunk and DOS when following the desktop theme", () => {
    document.documentElement.dataset.theme = "dark";
    document.documentElement.dataset.visualTheme = "cyberpunk";
    expect(resolveCodeMirrorThemeId("follow-app")).toBe("cyberpunk");

    document.documentElement.dataset.visualTheme = "dos";
    expect(resolveCodeMirrorThemeId("follow-app")).toBe("dos");
  });

  it("keeps an explicit Workbench editor appearance independent from the desktop visual theme", () => {
    document.documentElement.dataset.theme = "dark";
    document.documentElement.dataset.visualTheme = "dos";
    expect(resolveCodeMirrorThemeId("light")).toBe("classic-light");
    expect(resolveCodeMirrorThemeId("dark")).toBe("classic-dark");
  });

  it("reconfigures a mounted follow-app editor when the visual theme changes", async () => {
    document.documentElement.dataset.theme = "dark";
    document.documentElement.dataset.visualTheme = "cyberpunk";
    const { container } = render(
      <CodeEditor value="const theme = true;" language="javascript" ariaLabel="Theme editor" onChange={vi.fn()} />
    );
    const editor = container.querySelector(".cm-editor") as HTMLElement;
    expect(getComputedStyle(editor).backgroundColor).toBe("rgb(7, 6, 17)");

    document.documentElement.dataset.visualTheme = "dos";
    act(() => window.dispatchEvent(new CustomEvent("agent-resume:appearance-change")));
    await waitFor(() => expect(getComputedStyle(editor).backgroundColor).toBe("rgb(23, 18, 13)"));
  });
});

describe("CodeEditor controlled value synchronization", () => {
  it("does not report a programmatic disk reload as user input", async () => {
    const onChange = vi.fn();
    const { container, rerender } = render(
      <CodeEditor value="before" ariaLabel="Text editor" onChange={onChange} />
    );

    rerender(<CodeEditor value="after" ariaLabel="Text editor" onChange={onChange} />);

    await waitFor(() => expect(container.querySelector(".cm-content")?.textContent).toBe("after"));
    expect(onChange).not.toHaveBeenCalled();
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
