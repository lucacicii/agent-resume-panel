import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Tooltip } from "./Tooltip";

function renderTrigger(label: string): HTMLElement {
  render(
    <Tooltip label={label}>
      <button type="button">Trigger</button>
    </Tooltip>
  );
  return screen.getByRole("button", { name: "Trigger" });
}

describe("Tooltip", () => {
  afterEach(() => cleanup());

  it("renders no tooltip initially", () => {
    renderTrigger("Hello tip");
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("shows the label on hover and hides on leave", async () => {
    const trigger = renderTrigger("Hello tip");
    fireEvent.mouseOver(trigger);
    expect((await screen.findByRole("tooltip")).textContent).toBe("Hello tip");
    fireEvent.mouseOut(trigger);
    await waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull());
  });

  it("shows the label on keyboard focus", async () => {
    const trigger = renderTrigger("Focus tip");
    fireEvent.focusIn(trigger);
    expect((await screen.findByRole("tooltip")).textContent).toBe("Focus tip");
  });
});
