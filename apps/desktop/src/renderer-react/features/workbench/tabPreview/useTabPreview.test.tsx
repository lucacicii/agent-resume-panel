import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TabPreviewContent, TabPreviewTarget } from "./types";

const sourceMocks = vi.hoisted(() => ({ loadTabPreview: vi.fn() }));

vi.mock("./tabPreviewSource", () => ({ loadTabPreview: sourceMocks.loadTabPreview }));
vi.mock("../../../i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));

const { useTabPreview } = await import("./useTabPreview");

function Probe({ target }: { target: TabPreviewTarget | null }) {
  const { bind, card } = useTabPreview();
  return (
    <>
      <button data-testid="tab" {...bind(target)}>tab</button>
      {card}
    </>
  );
}

const target = (key: string): TabPreviewTarget => ({
  kind: "screen",
  key,
  title: key,
  accent: "terminal"
});

const screen = (text: string): TabPreviewContent => ({ kind: "screen", lines: [text] });

const cardEl = () => document.querySelector<HTMLElement>(".wb-tab-preview");
const cardText = () => cardEl()?.textContent ?? "";
const tabEl = (container: HTMLElement) => container.querySelector<HTMLElement>('[data-testid="tab"]')!;

/** Advance fake time and flush the load's microtask in one act(). */
const advance = async (ms: number) => {
  await act(async () => {
    vi.advanceTimersByTime(ms);
    await Promise.resolve();
  });
};

beforeEach(() => {
  vi.useFakeTimers();
  sourceMocks.loadTabPreview.mockReset();
  sourceMocks.loadTabPreview.mockImplementation(async (next: TabPreviewTarget) => screen(next.title));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("useTabPreview", () => {
  it("waits for the intent delay before opening", async () => {
    const { container } = render(<Probe target={target("a")} />);
    fireEvent.pointerOver(tabEl(container));

    await advance(349);
    expect(cardEl()).toBeNull();

    await advance(1);
    expect(cardText()).toContain("a");
    expect(sourceMocks.loadTabPreview).toHaveBeenCalledTimes(1);
  });

  it("cancels the intent when the pointer leaves early", async () => {
    const { container } = render(<Probe target={target("a")} />);
    fireEvent.pointerOver(tabEl(container));
    fireEvent.pointerOut(tabEl(container));

    await advance(500);
    expect(cardEl()).toBeNull();
    expect(sourceMocks.loadTabPreview).not.toHaveBeenCalled();
  });

  it("stays open while the pointer is over the card", async () => {
    const { container } = render(<Probe target={target("a")} />);
    fireEvent.pointerOver(tabEl(container));
    await advance(350);
    expect(cardEl()).not.toBeNull();

    fireEvent.pointerOut(tabEl(container));
    await advance(100);
    fireEvent.pointerOver(cardEl()!);

    await advance(400);
    expect(cardEl()).not.toBeNull();

    fireEvent.pointerOut(cardEl()!);
    await advance(140);
    expect(cardEl()).toBeNull();
  });

  it("closes on Escape, scroll, resize and an outside pointerdown", async () => {
    const { container } = render(<Probe target={target("a")} />);
    fireEvent.pointerOver(tabEl(container));
    await advance(350);
    expect(cardEl()).not.toBeNull();

    fireEvent.keyDown(window, { key: "Escape" });
    await advance(0);
    expect(cardEl()).toBeNull();

    fireEvent.pointerOver(tabEl(container));
    await advance(350);
    fireEvent.scroll(window);
    await advance(0);
    expect(cardEl()).toBeNull();

    fireEvent.pointerOver(tabEl(container));
    await advance(350);
    fireEvent(window, new Event("resize"));
    await advance(0);
    expect(cardEl()).toBeNull();

    fireEvent.pointerOver(tabEl(container));
    await advance(350);
    fireEvent.pointerDown(document.body);
    await advance(0);
    expect(cardEl()).toBeNull();
  });

  it("keeps the card when the pointer goes down inside it", async () => {
    const { container } = render(<Probe target={target("a")} />);
    fireEvent.pointerOver(tabEl(container));
    await advance(350);

    fireEvent.pointerDown(cardEl()!);
    await advance(0);
    expect(cardEl()).not.toBeNull();
  });

  it("never binds the active tab", async () => {
    const { container } = render(<Probe target={null} />);
    fireEvent.pointerOver(tabEl(container));
    await advance(500);
    expect(cardEl()).toBeNull();
    expect(sourceMocks.loadTabPreview).not.toHaveBeenCalled();
  });

  it("switches immediately between targets once a card is open", async () => {
    const { container, rerender } = render(<Probe target={target("a")} />);
    fireEvent.pointerOver(tabEl(container));
    await advance(350);
    expect(cardText()).toContain("a");

    rerender(<Probe target={target("b")} />);
    fireEvent.pointerOut(tabEl(container));
    fireEvent.pointerOver(tabEl(container));
    await advance(0);
    expect(cardText()).toContain("b");
  });

  it("drops a stale response that resolves after another target opened", async () => {
    let resolveA: (value: TabPreviewContent) => void = () => undefined;
    sourceMocks.loadTabPreview.mockImplementation((next: TabPreviewTarget) =>
      next.key === "a"
        ? new Promise<TabPreviewContent>((resolve) => { resolveA = resolve; })
        : Promise.resolve(screen("b"))
    );

    const { container, rerender } = render(<Probe target={target("a")} />);
    fireEvent.pointerOver(tabEl(container));
    await advance(350);

    rerender(<Probe target={target("b")} />);
    fireEvent.pointerOut(tabEl(container));
    fireEvent.pointerOver(tabEl(container));
    await advance(0);
    expect(cardText()).toContain("b");

    await act(async () => {
      resolveA(screen("late-a"));
      await Promise.resolve();
    });
    expect(cardText()).toContain("b");
    expect(cardText()).not.toContain("late-a");
  });
});
