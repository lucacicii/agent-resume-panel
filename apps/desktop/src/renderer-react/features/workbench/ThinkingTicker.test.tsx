import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import React from "react";
import { ThinkingTicker } from "./ThinkingTicker";

afterEach(cleanup);

type View = ReturnType<typeof render>;

/** The fixed-height window that clips the reel. */
function ticker(view: View): HTMLElement {
  return view.container.querySelector(".wb-thinking-ticker") as HTMLElement;
}

/** The moving track; it remounts whenever the reel rolls. */
function track(view: View): HTMLElement {
  return view.container.querySelector(".wb-thinking-ticker-track") as HTMLElement;
}

/** Every line the track holds (only `--wb-thinking-lines` of them are visible). */
function trackLines(view: View): string[] {
  return [...view.container.querySelectorAll(".wb-thinking-ticker-line")].map(
    (node) => node.textContent || ""
  );
}

function reel(view: View): { shift: string; duration: number } {
  const node = ticker(view);
  return {
    shift: node.style.getPropertyValue("--wb-thinking-shift"),
    duration: Number.parseInt(node.style.getPropertyValue("--wb-thinking-duration"), 10)
  };
}

describe("ThinkingTicker", () => {
  it("renders nothing without reasoning", () => {
    const view = render(<ThinkingTicker text="   " />);
    expect(view.container.querySelector(".wb-thinking-ticker")).toBeNull();
  });

  it("shows the newest line in an accessible-hidden single-line window", () => {
    const view = render(<ThinkingTicker text={"第一句话。\n第二句话。\n第三句话。"} />);
    expect(trackLines(view)).toEqual(["第三句话。"]);
    expect(ticker(view).getAttribute("aria-hidden")).toBe("true");
    expect(reel(view).shift).toBe("0");
  });

  it("does not roll before the window has filled up", () => {
    const view = render(<ThinkingTicker text="只有一句话。" />);
    expect(trackLines(view)).toEqual(["只有一句话。"]);
    expect(reel(view).shift).toBe("0");
  });

  it("rolls exactly one line for a single new chunk", () => {
    const view = render(<ThinkingTicker text="第一句话。" />);
    const before = track(view);
    view.rerender(<ThinkingTicker text={"第一句话。\n第二句话。"} />);
    const after = track(view);
    // Remounting the track restarts the CSS roll animation.
    expect(after).not.toBe(before);
    expect(trackLines(view)).toEqual(["第一句话。", "第二句话。"]);
    expect(reel(view).shift).toBe("1");
  });

  it("spins through several lines when a poll delivers a burst", () => {
    const view = render(<ThinkingTicker text="one sentence here." />);
    const burst = ["one sentence here.", "second line.", "third line.", "fourth line.", "fifth line."].join("\n");
    view.rerender(<ThinkingTicker text={burst} />);
    // Four incoming lines: the reel holds the outgoing line plus the four
    // arriving ones and spins four slots to land on the newest.
    expect(trackLines(view)).toEqual([
      "one sentence here.",
      "second line.",
      "third line.",
      "fourth line.",
      "fifth line."
    ]);
    expect(reel(view).shift).toBe("4");
    expect(reel(view).duration).toBeLessThanOrEqual(320);
  });

  it("caps how far a single burst can spin", () => {
    const view = render(<ThinkingTicker text="start" />);
    const burst = Array.from({ length: 20 }, (_value, index) => `line number ${index}.`).join("\n");
    view.rerender(<ThinkingTicker text={burst} />);
    expect(reel(view).shift).toBe("6");
    expect(trackLines(view).length).toBe(7);
  });

  it("stays still when only the open line grows", () => {
    const view = render(<ThinkingTicker text={"第一句话。\n第二句"} />);
    const before = track(view);
    view.rerender(<ThinkingTicker text={"第一句话。\n第二句话在增长"} />);
    expect(track(view)).toBe(before);
    expect(trackLines(view)).toEqual(["第二句话在增长"]);
    expect(reel(view).shift).toBe("0");
  });

  it("rolls at constant speed", () => {
    const stylesheet = readFileSync(
      path.join(__dirname, "..", "..", "..", "..", "src", "renderer", "styles.css"),
      "utf8"
    );
    const trackRule = stylesheet.slice(stylesheet.indexOf(".wb-thinking-ticker-track {"));
    const animation = trackRule.slice(0, trackRule.indexOf("}"));
    // The reel is a wheel: a steady spin reads as rotation, an eased curve
    // reads as a settle. The duration stays a variable the component drives.
    expect(animation).toContain("animation: wb-thinking-roll var(--wb-thinking-duration");
    expect(animation).toContain("linear");
    expect(animation).not.toContain("cubic-bezier");
  });
});
