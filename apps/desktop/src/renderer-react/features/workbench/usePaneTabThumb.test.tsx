import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { usePaneTabThumb } from "./usePaneTabThumb";

function Probe({ activeKey }: { activeKey: string }): React.JSX.Element {
  const { listRef, thumb } = usePaneTabThumb(activeKey, 2);
  return (
    <div ref={listRef} className="wb-terminal-tabs-list">
      <span id="tab-a" className={`wb-terminal-tab${activeKey === "a" ? " active" : ""}`} />
      <span id="tab-b" className={`wb-terminal-tab${activeKey === "b" ? " active" : ""}`} />
      <output data-thumb={thumb.visible ? `${thumb.x}:${thumb.width}` : "hidden"} />
    </div>
  );
}

const box = (element: Element | null, left: number, width: number) => {
  Object.defineProperty(element, "offsetLeft", { value: left, configurable: true });
  Object.defineProperty(element, "offsetWidth", { value: width, configurable: true });
};

const thumbBox = (container: HTMLElement) =>
  container.querySelector("[data-thumb]")?.getAttribute("data-thumb");

describe("usePaneTabThumb", () => {
  afterEach(cleanup);

  it("measures the active tab in content coordinates", () => {
    const { container, rerender } = render(<Probe activeKey="a" />);
    box(container.querySelector("#tab-a"), 12, 80);
    box(container.querySelector("#tab-b"), 100, 60);
    box(container.querySelector(".wb-terminal-tabs-list"), 0, 400);

    rerender(<Probe activeKey="b" />);
    expect(thumbBox(container)).toBe("100:60");
  });

  it("hides the pill when the list has no active tab", () => {
    const { container, rerender } = render(<Probe activeKey="a" />);
    box(container.querySelector("#tab-a"), 12, 80);
    box(container.querySelector(".wb-terminal-tabs-list"), 0, 400);
    rerender(<Probe activeKey="none" />);
    expect(thumbBox(container)).toBe("hidden");
  });

  it("treats an unlaid-out tab as hidden instead of drawing a zero-width pill", () => {
    const { container } = render(<Probe activeKey="a" />);
    expect(thumbBox(container)).toBe("hidden");
  });
});
