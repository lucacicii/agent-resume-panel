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

describe("ThinkingState auto-scroll", () => {
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

  it("A strategy: follows the newest reasoning while streaming", () => {
    const { rerender } = render(<ThinkingState reasoning="step 1" isStreaming />);
    expect(getContent().scrollTop).toBe(THINKING_SCROLL_HEIGHT);

    rerender(<ThinkingState reasoning="step 1 step 2" isStreaming />);
    expect(getContent().scrollTop).toBe(THINKING_SCROLL_HEIGHT);

    rerender(<ThinkingState reasoning="step 1 step 2 step 3" isStreaming />);
    expect(getContent().scrollTop).toBe(THINKING_SCROLL_HEIGHT);
  });

  it("stops following after the user scrolls up, and resumes at the newest position", () => {
    const { rerender } = render(<ThinkingState reasoning="step 1" isStreaming />);

    // User scrolls up → B strategy.
    const scrolledUp = getContent();
    scrolledUp.scrollTop = 0;
    fireEvent.scroll(scrolledUp);

    rerender(<ThinkingState reasoning="step 1 fresh content arrives" isStreaming />);
    expect(getContent().scrollTop).toBe(0);

    // User scrolls back to the newest position → A strategy resumes.
    const atBottom = getContent();
    atBottom.scrollTop = THINKING_SCROLL_HEIGHT - THINKING_CLIENT_HEIGHT;
    fireEvent.scroll(atBottom);

    rerender(<ThinkingState reasoning="step 1 fresh content arrives again" isStreaming />);
    expect(getContent().scrollTop).toBe(THINKING_SCROLL_HEIGHT);
  });

  it("pins to the newest reasoning when the panel is expanded", () => {
    render(<ThinkingState reasoning="historical reasoning" />);
    expect(document.querySelector(".tb-thinking-content")).toBeNull();

    fireEvent.click(document.querySelector(".tb-thinking-header")!);

    expect(getContent().scrollTop).toBe(THINKING_SCROLL_HEIGHT);
  });
});
