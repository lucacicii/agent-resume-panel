import { cleanup, render } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TabPreviewState } from "./useTabPreview";
import type { TabPreviewContent, TabPreviewTarget } from "./types";

vi.mock("../../../i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));

const { TabPreviewCard } = await import("./TabPreviewCard");

const rect = (left: number, top: number, width = 80, height = 24): DOMRect =>
  ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top,
     toJSON: () => ({}) }) as DOMRect;

const target: TabPreviewTarget = {
  kind: "screen",
  key: "terminal:1",
  title: "Terminal 1",
  meta: "codex · app",
  accent: "terminal"
};

const stateOf = (content: TabPreviewContent, anchor = rect(100, 40)): TabPreviewState => ({
  phase: "ready",
  target,
  anchor,
  content
});

const renderCard = (state: TabPreviewState) => {
  const ref = createRef<HTMLDivElement>();
  const result = render(
    <TabPreviewCard state={state} cardRef={ref} onPointerEnter={() => undefined} onPointerLeave={() => undefined} />
  );
  return { ...result, card: document.querySelector<HTMLElement>(".wb-tab-preview")! };
};

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("TabPreviewCard", () => {
  it("renders a screen as monospace text and escapes the layout with a body portal", () => {
    const { card } = renderCard(stateOf({ kind: "screen", lines: ["$ npm test", "green"] }));
    expect(card.parentElement).toBe(document.body);
    expect(card.getAttribute("aria-hidden")).toBe("true");
    expect(card.classList.contains("is-terminal-group")).toBe(true);
    expect(card.querySelector(".wb-tab-preview-title")?.textContent).toBe("Terminal 1");
    expect(card.querySelector(".wb-tab-preview-meta")?.textContent).toBe("codex · app");
    expect(card.querySelector("pre.wb-tab-preview-screen")?.textContent).toBe("$ npm test\ngreen");
  });

  it("labels previewed messages as you and assistant", () => {
    const { card } = renderCard(stateOf({
      kind: "messages",
      messages: [
        { role: "user", text: "question" },
        { role: "assistant", text: "answer" }
      ]
    }));
    const roles = Array.from(card.querySelectorAll(".wb-tab-preview-role")).map((node) => node.textContent);
    expect(roles).toEqual([
      "desktop.workbench.tabPreviewYou",
      "desktop.workbench.tabPreviewAssistant"
    ]);
    expect(card.textContent).toContain("answer");
  });

  it("shows the diff counts and signed excerpt lines", () => {
    const { card } = renderCard(stateOf({
      kind: "diff",
      added: 2,
      removed: 1,
      lines: [
        { kind: "del", text: "old" },
        { kind: "add", text: "new" },
        { kind: "add", text: "more" }
      ]
    }));
    expect(card.querySelector(".wb-tab-preview-counts")?.textContent).toBe("+2−1");
    expect(card.querySelector("pre")?.textContent).toBe("−old\n+new\n+more");
  });

  it("renders loading and error placeholders", () => {
    const loading = renderCard({ phase: "loading", target, anchor: rect(10, 10) });
    expect(loading.card.textContent).toContain("desktop.common.loadingPreview");
    loading.unmount();

    const error = renderCard({ phase: "error", target, anchor: rect(10, 10) });
    expect(error.card.textContent).toContain("desktop.workbench.tabPreviewError");
  });

  it("clamps a centered card to the viewport edge", () => {
    const { card } = renderCard(stateOf({ kind: "screen", lines: ["x"] }, rect(0, 40, 10)));
    expect(card.style.left).toBe("8px");
  });

  it("flips above the tab when the strip is near the bottom", () => {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");
    const originalInnerHeight = window.innerHeight;
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, get: () => 100 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 300 });
    try {
      const { card } = renderCard(stateOf({ kind: "screen", lines: ["x"] }, rect(100, 250)));
      expect(card.classList.contains("is-above")).toBe(true);
      expect(card.style.top).toBe("150px");
    } finally {
      if (descriptor) Object.defineProperty(HTMLElement.prototype, "offsetHeight", descriptor);
      Object.defineProperty(window, "innerHeight", { configurable: true, value: originalInnerHeight });
    }
  });
});
