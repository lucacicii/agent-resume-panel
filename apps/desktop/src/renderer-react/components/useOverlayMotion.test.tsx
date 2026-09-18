import { act, cleanup, render, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type React from "react";
import { OVERLAY_EXIT_MS, useOverlayPresence, useOverlayState } from "./useOverlayMotion";

function OverlayProbe({ open }: { open: boolean }): React.JSX.Element | null {
  const presence = useOverlayPresence(open);
  if (!presence.mounted) return null;
  return <div className={`probe-overlay${presence.closing ? " is-closing" : ""}`} />;
}

describe("useOverlayPresence", () => {
  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it("keeps the same node through the exit instead of remounting it", () => {
    const { rerender } = render(<OverlayProbe open />);
    const overlay = document.querySelector(".probe-overlay");
    expect(overlay).not.toBeNull();

    rerender(<OverlayProbe open={false} />);
    // Losing the node here would drop it for a frame and restart the animation,
    // which reads as a flash instead of an exit.
    expect(document.querySelector(".probe-overlay")).toBe(overlay);
    expect(overlay?.className).toContain("is-closing");

    rerender(<OverlayProbe open={false} />);
    expect(document.querySelector(".probe-overlay")).toBe(overlay);
  });

  it("stays mounted while the exit runs, then unmounts", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ open }) => useOverlayPresence(open), {
      initialProps: { open: true }
    });
    expect(result.current).toEqual({ mounted: true, closing: false });

    rerender({ open: false });
    expect(result.current).toEqual({ mounted: true, closing: true });

    act(() => {
      vi.advanceTimersByTime(OVERLAY_EXIT_MS);
    });
    expect(result.current).toEqual({ mounted: false, closing: false });
  });

  it("does not mount a surface that was never opened", () => {
    const { result } = renderHook(() => useOverlayPresence(false));
    expect(result.current).toEqual({ mounted: false, closing: false });
  });

  it("cancels a running exit when the surface reopens", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ open }) => useOverlayPresence(open), {
      initialProps: { open: true }
    });

    rerender({ open: false });
    rerender({ open: true });
    expect(result.current).toEqual({ mounted: true, closing: false });

    act(() => {
      vi.advanceTimersByTime(OVERLAY_EXIT_MS);
    });
    expect(result.current).toEqual({ mounted: true, closing: false });
  });
});

describe("useOverlayState", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps the last value through the exit and clears it afterwards", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useOverlayState<{ title: string }>());

    act(() => {
      result.current[1]({ title: "Rename" });
    });
    expect(result.current[0]).toEqual({ title: "Rename" });
    expect(result.current[2]).toBe(false);

    act(() => {
      result.current[1](null);
    });
    expect(result.current[0]).toEqual({ title: "Rename" });
    expect(result.current[2]).toBe(true);

    act(() => {
      vi.advanceTimersByTime(OVERLAY_EXIT_MS);
    });
    expect(result.current[0]).toBeNull();
    expect(result.current[2]).toBe(false);
  });

  it("supports updater functions", () => {
    const { result } = renderHook(() => useOverlayState<{ title: string }>());
    act(() => {
      result.current[1]({ title: "a" });
    });
    act(() => {
      result.current[1]((current) => (current ? { ...current, title: "b" } : current));
    });
    expect(result.current[0]).toEqual({ title: "b" });
  });

  it("ignores a repeated dismissal so the exit cannot restart", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useOverlayState<{ title: string }>());
    act(() => {
      result.current[1]({ title: "a" });
    });

    act(() => {
      result.current[1](null);
    });
    act(() => {
      vi.advanceTimersByTime(OVERLAY_EXIT_MS - 40);
    });
    act(() => {
      result.current[1](null);
    });
    act(() => {
      vi.advanceTimersByTime(40);
    });
    expect(result.current[0]).toBeNull();
  });

  it("clears a pending exit when a new value arrives", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useOverlayState<{ title: string }>());
    act(() => {
      result.current[1]({ title: "a" });
    });
    act(() => {
      result.current[1](null);
    });
    act(() => {
      result.current[1]({ title: "b" });
    });
    expect(result.current[0]).toEqual({ title: "b" });
    expect(result.current[2]).toBe(false);

    act(() => {
      vi.advanceTimersByTime(OVERLAY_EXIT_MS);
    });
    expect(result.current[0]).toEqual({ title: "b" });
  });
});
