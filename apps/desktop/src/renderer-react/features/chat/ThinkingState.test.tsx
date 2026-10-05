import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ThinkingState } from "./ThinkingState";

const THINKING_SCROLL_HEIGHT = 1200;
const THINKING_CLIENT_HEIGHT = 280;

// jsdom has no layout, so the thinking panel reports scroll metrics through
// prototype-level getters scoped to `.tb-thinking-content`. Prototype scope (not
// per-node) is required because collapsing/expanding replaces the node.
const scrollHeightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollHeight");
const clientHeightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");

function getContent(): HTMLElement {
  const el = document.querySelector(".tb-thinking-content");
  if (!el) throw new Error(".tb-thinking-content was not rendered");
  return el as HTMLElement;
}

function getTickerCurrent(): HTMLElement {
  const el = document.querySelector(".tb-thinking-ticker-row.is-current");
  if (!el) throw new Error(".tb-thinking-ticker-row.is-current was not rendered");
  return el as HTMLElement;
}

function expand(): void {
  fireEvent.click(document.querySelector(".tb-thinking-header")!);
}

describe("ThinkingState", () => {
  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
      configurable: true,
      get(this: HTMLElement) {
        return this.classList?.contains("tb-thinking-content")
          ? THINKING_SCROLL_HEIGHT
          : (scrollHeightDescriptor?.get?.call(this) ?? 0);
      }
    });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", {
      configurable: true,
      get(this: HTMLElement) {
        return this.classList?.contains("tb-thinking-content")
          ? THINKING_CLIENT_HEIGHT
          : (clientHeightDescriptor?.get?.call(this) ?? 0);
      }
    });
  });

  afterEach(() => {
    cleanup();
    if (scrollHeightDescriptor) Object.defineProperty(HTMLElement.prototype, "scrollHeight", scrollHeightDescriptor);
    else delete (HTMLElement.prototype as { scrollHeight?: unknown }).scrollHeight;
    if (clientHeightDescriptor) Object.defineProperty(HTMLElement.prototype, "clientHeight", clientHeightDescriptor);
    else delete (HTMLElement.prototype as { clientHeight?: unknown }).clientHeight;
  });

  it("stays collapsed while streaming and wheels the newest line through the ticker", () => {
    const { rerender } = render(<ThinkingState reasoning="line 1" isStreaming />);
    expect(document.querySelector(".tb-thinking-content")).toBeNull();
    expect(getTickerCurrent().textContent).toBe("line 1");

    rerender(<ThinkingState reasoning={"line 1\nline 2"} isStreaming />);
    const rows = document.querySelectorAll(".tb-thinking-ticker-row");
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toBe("line 1");
    expect(getTickerCurrent().textContent).toBe("line 2");

    rerender(<ThinkingState reasoning={"line 1\nline 2\nline 3"} isStreaming />);
    expect(getTickerCurrent().textContent).toBe("line 3");
  });

  it("updates the current line in place instead of re-rolling on every token", () => {
    const { rerender } = render(<ThinkingState reasoning={"line 1\nline 2"} isStreaming />);
    const roll = document.querySelector(".tb-thinking-ticker-roll");

    rerender(<ThinkingState reasoning={"line 1\nline 2 grows taller"} isStreaming />);
    expect(getTickerCurrent().textContent).toBe("line 2 grows taller");
    expect(document.querySelectorAll(".tb-thinking-ticker-roll").length).toBe(1);
    expect(document.querySelector(".tb-thinking-ticker-roll")).toBe(roll);
  });

  it("expands on click and pins to the newest reasoning", () => {
    render(<ThinkingState reasoning={"step 1\nstep 2"} />);
    expect(document.querySelector(".tb-thinking-content")).toBeNull();

    expand();

    expect(getContent().scrollTop).toBe(THINKING_SCROLL_HEIGHT);
  });

  it("follows the newest reasoning while expanded", () => {
    const { rerender } = render(<ThinkingState reasoning="step 1" />);
    expand();

    rerender(<ThinkingState reasoning="step 1 step 2" />);
    expect(getContent().scrollTop).toBe(THINKING_SCROLL_HEIGHT);

    rerender(<ThinkingState reasoning="step 1 step 2 step 3" />);
    expect(getContent().scrollTop).toBe(THINKING_SCROLL_HEIGHT);
  });

  it("stops following after the user scrolls up, and resumes at the newest position", () => {
    const { rerender } = render(<ThinkingState reasoning="step 1" />);
    expand();

    // User scrolls up → B strategy.
    const scrolledUp = getContent();
    scrolledUp.scrollTop = 0;
    fireEvent.scroll(scrolledUp);

    rerender(<ThinkingState reasoning="step 1 fresh content arrives" />);
    expect(getContent().scrollTop).toBe(0);

    // User scrolls back to the newest position → A strategy resumes.
    const atBottom = getContent();
    atBottom.scrollTop = THINKING_SCROLL_HEIGHT - THINKING_CLIENT_HEIGHT;
    fireEvent.scroll(atBottom);

    rerender(<ThinkingState reasoning="step 1 fresh content arrives again" />);
    expect(getContent().scrollTop).toBe(THINKING_SCROLL_HEIGHT);
  });

  it("settles into a one-line excerpt once the run is over", () => {
    render(<ThinkingState reasoning={"first line\nsecond line\nthird line"} />);

    expect(document.querySelector(".tb-thinking-ticker")).toBeNull();
    expect(document.querySelector(".tb-thinking-excerpt")?.textContent).toBe("3 lines · first line");
  });

  it("renders nothing without reasoning or a run", () => {
    render(<ThinkingState reasoning="" />);
    expect(document.querySelector(".tb-thinking-container")).toBeNull();
  });
});
