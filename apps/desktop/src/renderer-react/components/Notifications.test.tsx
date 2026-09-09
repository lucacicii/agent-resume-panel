import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Notifications, notifyDesktop } from "./Notifications";
import { clearAll, getHistory } from "./notificationStore";

afterEach(() => {
  cleanup();
  clearAll();
  vi.useRealTimers();
});

describe("Notifications", () => {
  it("shows global notifications for three seconds before sliding out", () => {
    vi.useFakeTimers();
    render(<Notifications />);

    act(() => notifyDesktop({ text: "Current repository has no changes", kind: "error" }));
    expect(screen.getByRole("alert").textContent).toBe("Current repository has no changes");
    expect(getHistory()[0]).toMatchObject({
      text: "Current repository has no changes",
      kind: "error"
    });

    act(() => vi.advanceTimersByTime(3000));
    expect(screen.getByRole("alert").classList.contains("is-exiting")).toBe(true);

    act(() => vi.advanceTimersByTime(280));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
