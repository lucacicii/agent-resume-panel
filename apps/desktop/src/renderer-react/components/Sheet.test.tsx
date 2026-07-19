import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Sheet } from "./Sheet";

describe("Sheet", () => {
  afterEach(() => cleanup());

  it("closes from its backdrop and Escape key", () => {
    const onClose = vi.fn();
    render(
      <Sheet open title="Sessions" onClose={onClose}>
        Body
      </Sheet>
    );

    fireEvent.click(screen.getByRole("button", { name: "Dismiss Sessions" }));
    fireEvent.keyDown(window, { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("does not render when closed", () => {
    render(
      <Sheet open={false} title="Sessions" onClose={() => undefined}>
        Body
      </Sheet>
    );

    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
