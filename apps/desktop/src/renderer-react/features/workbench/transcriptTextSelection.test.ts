import { afterEach, describe, expect, it, vi } from "vitest";
import { applyTranscriptPointerSelection, rangeFromBoundary, rangeFromPoint } from "./transcriptTextSelection";

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
  window.getSelection()?.removeAllRanges();
});

describe("rangeFromPoint", () => {
  it("collapses caretRangeFromPoint to the click offset", () => {
    const host = document.createElement("div");
    host.textContent = "hello world";
    document.body.append(host);
    const caretRangeFromPoint = vi.fn(() => {
      const wide = document.createRange();
      wide.selectNodeContents(host);
      return wide;
    });
    Object.defineProperty(document, "caretRangeFromPoint", {
      configurable: true,
      value: caretRangeFromPoint
    });
    const range = rangeFromPoint(12, 8);
    expect(caretRangeFromPoint).toHaveBeenCalledWith(12, 8);
    expect(range?.collapsed).toBe(true);
  });
});

describe("rangeFromBoundary", () => {
  it("orders the click point against the drag anchor", () => {
    const host = document.createElement("div");
    host.textContent = "hello world";
    document.body.append(host);
    const text = host.firstChild as Text;
    const anchor = document.createRange();
    anchor.setStart(text, 2);
    anchor.collapse(true);
    const point = document.createRange();
    point.setStart(text, 8);
    point.collapse(true);
    const forward = rangeFromBoundary(anchor, point);
    expect(forward.startOffset).toBe(2);
    expect(forward.endOffset).toBe(8);
    const backward = rangeFromBoundary(point, anchor);
    expect(backward.startOffset).toBe(2);
    expect(backward.endOffset).toBe(8);
  });
});

describe("applyTranscriptPointerSelection", () => {
  it("places a collapsed caret when there is no drag anchor", () => {
    const host = document.createElement("div");
    host.textContent = "Use bold text.";
    document.body.append(host);
    const expected = document.createRange();
    expected.setStart(host.firstChild as Text, 4);
    expected.collapse(true);
    Object.defineProperty(document, "caretRangeFromPoint", {
      configurable: true,
      value: () => expected.cloneRange()
    });
    const point = applyTranscriptPointerSelection(host, 20, 10, null);
    const selection = window.getSelection();
    expect(point?.startOffset).toBe(4);
    expect(selection?.isCollapsed).toBe(true);
    expect(selection?.anchorOffset).toBe(4);
  });
});
