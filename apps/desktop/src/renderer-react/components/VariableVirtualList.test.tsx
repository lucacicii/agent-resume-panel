import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { useRef, useState, type JSX } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { VariableVirtualList, type VariableVirtualListHandle } from "./VariableVirtualList";

const ITEM_COUNT = 40;
const ESTIMATE = 50;
const ACTUAL_HEIGHT = 320;
const VIEWPORT_HEIGHT = 600;
const TARGET_INDEX = 4;

function items(): Array<{ id: string }> {
  return Array.from({ length: ITEM_COUNT }, (_, index) => ({ id: `item-${index}` }));
}

function Harness(): JSX.Element {
  const ref = useRef<VariableVirtualListHandle | null>(null);
  const [pinned, setPinned] = useState(true);
  const rows = items();
  return (
    <div>
      <button
        type="button"
        onClick={() => {
          setPinned(false);
          ref.current?.scrollToIndex(TARGET_INDEX, { align: "start", behavior: "smooth" });
        }}
      >
        jump
      </button>
      <VariableVirtualList
        ref={ref}
        className="test-virtual-list"
        items={rows}
        getKey={(item) => item.id}
        estimateSize={() => ESTIMATE}
        gap={0}
        overscan={2}
        pinToBottom={pinned}
        renderItem={(item) => (
          <div data-testid={`row-${item.id}`} style={{ height: ACTUAL_HEIGHT }}>
            {item.id}
          </div>
        )}
      />
    </div>
  );
}

describe("VariableVirtualList", () => {
  const scrollTopDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollTop");
  const clientHeightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");
  const boundingRect = HTMLElement.prototype.getBoundingClientRect;

  beforeEach(() => {
    const scrollTops = new WeakMap<HTMLElement, number>();
    Object.defineProperty(HTMLElement.prototype, "scrollTop", {
      configurable: true,
      get() {
        return scrollTops.get(this) ?? 0;
      },
      set(value: number) {
        scrollTops.set(this, Number(value) || 0);
      }
    });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", {
      configurable: true,
      get() {
        if (this.classList?.contains("variable-virtual-list") || this.classList?.contains("test-virtual-list")) {
          return VIEWPORT_HEIGHT;
        }
        return 0;
      }
    });
    HTMLElement.prototype.getBoundingClientRect = function () {
      const height = this.classList?.contains("virtual-list-row-variable") ? ACTUAL_HEIGHT : 0;
      return {
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        width: 400,
        height,
        right: 400,
        bottom: height,
        toJSON() {
          return {};
        }
      } as DOMRect;
    };
  });

  afterEach(() => {
    cleanup();
    if (scrollTopDescriptor) {
      Object.defineProperty(HTMLElement.prototype, "scrollTop", scrollTopDescriptor);
    }
    if (clientHeightDescriptor) {
      Object.defineProperty(HTMLElement.prototype, "clientHeight", clientHeightDescriptor);
    }
    HTMLElement.prototype.getBoundingClientRect = boundingRect;
  });

  it("settles a jump to an unmeasured row in one scrollToIndex call", async () => {
    const view = render(<Harness />);

    await waitFor(() => {
      expect(document.querySelector("[data-virtual-key='item-39']")).not.toBeNull();
    });
    expect(document.querySelector(`[data-virtual-key='item-${TARGET_INDEX}']`)).toBeNull();

    await act(async () => {
      fireEvent.click(view.getByText("jump"));
    });

    await waitFor(() => {
      expect(document.querySelector(`[data-virtual-key='item-${TARGET_INDEX}']`)).not.toBeNull();
    });
    expect(view.getByTestId(`row-item-${TARGET_INDEX}`).textContent).toBe(`item-${TARGET_INDEX}`);
  });
});
