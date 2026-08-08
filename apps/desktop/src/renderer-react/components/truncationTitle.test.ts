import { describe, expect, it } from "vitest";
import { syncTruncationTitle } from "./truncationTitle";

function makeEl(width: number, height: number): HTMLElement {
  const el = document.createElement("span");
  el.textContent = "A very long session title that gets truncated";
  Object.defineProperty(el, "scrollWidth", { configurable: true, value: width });
  Object.defineProperty(el, "clientWidth", { configurable: true, value: width });
  Object.defineProperty(el, "scrollHeight", { configurable: true, value: height });
  Object.defineProperty(el, "clientHeight", { configurable: true, value: height });
  return el;
}

describe("syncTruncationTitle", () => {
  it("sets the title attribute when the text overflows horizontally", () => {
    const el = makeEl(200, 18);
    Object.defineProperty(el, "clientWidth", { configurable: true, value: 100 });
    syncTruncationTitle(el);
    expect(el.getAttribute("title")).toBe(el.textContent);
  });

  it("sets the title attribute when the text overflows vertically (line-clamp)", () => {
    const el = makeEl(200, 40);
    Object.defineProperty(el, "clientHeight", { configurable: true, value: 20 });
    syncTruncationTitle(el);
    expect(el.getAttribute("title")).toBe(el.textContent);
  });

  it("removes the title attribute when the text fits", () => {
    const el = makeEl(200, 18);
    el.setAttribute("title", "stale");
    syncTruncationTitle(el);
    expect(el.hasAttribute("title")).toBe(false);
  });

  it("ignores a one-pixel overflow rounding difference", () => {
    const el = makeEl(201, 18);
    Object.defineProperty(el, "clientWidth", { configurable: true, value: 200 });
    syncTruncationTitle(el);
    expect(el.hasAttribute("title")).toBe(false);
  });

  it("does nothing for a null element", () => {
    expect(() => syncTruncationTitle(null)).not.toThrow();
  });
});
