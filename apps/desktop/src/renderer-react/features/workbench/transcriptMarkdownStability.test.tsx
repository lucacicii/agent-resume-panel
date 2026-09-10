import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import React, { useState } from "react";

const counts = vi.hoisted(() => ({ parses: 0, streamdown: 0 }));
/** Every markdown body render, with the fade-in state it was rendered with. */
const rendered = vi.hoisted(() => [] as Array<{ content: string; fading: boolean }>);

// Both counters matter: `parses` counts markdown sanitizing/pipeline work,
// `streamdown` counts full render passes of a markdown body. TUI interaction
// must grow neither, or the pane visibly re-renders while the user types.
vi.mock("../../components/Markdown", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../components/Markdown")>();
  return {
    ...actual,
    sanitizeMarkdownProseTags: (value: string) => {
      counts.parses += 1;
      return actual.sanitizeMarkdownProseTags(value);
    }
  };
});

vi.mock("streamdown", async (importOriginal) => {
  const actual = await importOriginal<typeof import("streamdown")>();
  const Wrapped = (props: { children: string; isAnimating?: boolean; animated?: unknown }) => {
    counts.streamdown += 1;
    rendered.push({ content: String(props.children), fading: Boolean(props.animated) });
    return React.createElement("div", { className: "fake-streamdown" }, props.children);
  };
  return { ...actual, Streamdown: Wrapped };
});

const apiMocks = vi.hoisted(() => ({
  previewSession: vi.fn(),
  imRunSelectionAction: vi.fn()
}));
vi.mock("../../bridge", () => ({ desktopApi: () => apiMocks }));
// The real provider memoizes its context value, so `t` keeps its identity for
// the lifetime of a locale. Mirroring that is what makes this test meaningful.
const stableI18n = { locale: "en", ready: true, messages: {}, t: (key: string) => key };
vi.mock("../../i18n", () => ({ useI18n: () => stableI18n }));

const { SessionTranscriptPane } = await import("./SessionTranscriptPane");

afterEach(() => {
  cleanup();
  apiMocks.previewSession.mockReset();
  counts.parses = 0;
  counts.streamdown = 0;
  rendered.length = 0;
});

const MESSAGES = [
  { role: "user", text: "First question stays put." },
  { role: "assistant", text: "First answer stays put." },
  { role: "user", text: "Second question stays put." },
  { role: "assistant", text: "Streaming answer arrives" }
];

function setupPreview(): void {
  apiMocks.previewSession.mockResolvedValue({
    session: { provider: "codex", id: "session-1" },
    preview: { title: "Session", messages: MESSAGES }
  });
}

describe("TUI interaction must not re-render transcript markdown", () => {
  it("ignores parent re-renders", async () => {
    setupPreview();
    function Harness() {
      const [, setTick] = useState(0);
      return (
        <div>
          <button type="button" onClick={() => setTick((value) => value + 1)}>tick</button>
          <SessionTranscriptPane provider="codex" sessionId="session-1" active />
        </div>
      );
    }
    const view = render(<Harness />);
    await screen.findByText("Streaming answer arrives");
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });

    const markdownNode = view.container.querySelector(".wb-transcript-md");
    const paragraph = view.container.querySelector(".wb-transcript-md p");
    const parses = counts.parses;
    const renders = counts.streamdown;

    for (let index = 0; index < 5; index += 1) {
      await act(async () => { screen.getByText("tick").click(); });
    }

    expect(counts.parses).toBe(parses);
    expect(counts.streamdown).toBe(renders);
    expect(view.container.querySelector(".wb-transcript-md")).toBe(markdownNode);
    expect(view.container.querySelector(".wb-transcript-md p")).toBe(paragraph);
  });

  it("ignores the streaming flag flapping while the TUI runs and idles", async () => {
    setupPreview();
    function Harness() {
      // Typing in the TUI flips the session between running and idle; each flip
      // used to re-parse every message's markdown.
      const [running, setRunning] = useState(false);
      return (
        <div>
          <button type="button" onClick={() => setRunning((value) => !value)}>flap</button>
          <SessionTranscriptPane provider="codex" sessionId="session-1" active isRunning={running} />
        </div>
      );
    }
    const view = render(<Harness />);
    await screen.findByText("Streaming answer arrives");
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });

    const markdownNode = view.container.querySelector(".wb-transcript-md");
    const parses = counts.parses;
    const renders = counts.streamdown;

    for (let index = 0; index < 4; index += 1) {
      await act(async () => {
        screen.getByText("flap").click();
        await new Promise((resolve) => setTimeout(resolve, 5));
      });
    }
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 550)); });

    // The streaming caret is a container class, not part of the parsed body.
    expect(view.container.querySelector(".wb-transcript-md")).toBe(markdownNode);
    expect(counts.parses).toBe(parses);
    expect(counts.streamdown).toBe(renders);
  });

  it("still fades in the text that actually arrived", async () => {
    let preview: { title: string; messages: Array<{ role: string; text: string }> } = {
      title: "Live",
      messages: [{ role: "assistant", text: "Streaming answer arrives" }]
    };
    apiMocks.previewSession.mockImplementation(async () => ({
      session: { provider: "codex", id: "session-1" },
      preview
    }));

    render(<SessionTranscriptPane provider="codex" sessionId="session-1" active isRunning />);
    await waitFor(() => expect(rendered.some((entry) => entry.content.includes("Streaming answer arrives"))).toBe(true));
    expect(document.querySelector(".wb-transcript-md")?.className).toContain("is-streaming");

    rendered.length = 0;
    preview = {
      title: "Live",
      messages: [{ role: "assistant", text: "Streaming answer arrives with more text" }]
    };
    await waitFor(
      () => expect(document.querySelector(".wb-transcript-md")?.textContent).toContain("with more text"),
      { timeout: 3500 }
    );

    // Only the segment that grew is re-rendered, and it renders with the
    // fade-in enabled so newly streamed tokens still animate in.
    expect(rendered).toHaveLength(1);
    expect(rendered[0].content).toContain("with more text");
    expect(rendered[0].fading).toBe(true);
  });
});
