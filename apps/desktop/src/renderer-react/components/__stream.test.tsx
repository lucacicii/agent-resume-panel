import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { StreamdownRenderer } from "./StreamdownRenderer";

const stableT = (key: string) => key;
vi.mock("../i18n", () => ({
  useI18n: () => ({ locale: "en", t: stableT })
}));

afterEach(cleanup);

const FIRST = "# Title\n\nFirst paragraph with **bold** text.\n\nSecond paragraph stays stable.\n\n";

describe("streaming re-render", () => {
  it("keeps early DOM stable when the tail grows", () => {
    const view = render(<StreamdownRenderer content={`${FIRST}tail`} isAnimating />);
    const before = [...view.container.querySelectorAll("p")].map((node) => node.outerHTML);
    const nodeBefore = view.container.querySelector("p");
    view.rerender(<StreamdownRenderer content={`${FIRST}tail grows more`} isAnimating />);
    const after = [...view.container.querySelectorAll("p")].map((node) => node.outerHTML);
    console.log("BEFORE", before[0]);
    console.log("AFTER", after[0]);
    console.log("SAME NODE", nodeBefore === view.container.querySelector("p"));
    expect(after[0]).toBe(before[0]);
  });
});
