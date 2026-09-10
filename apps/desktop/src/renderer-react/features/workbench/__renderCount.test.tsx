import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";

const apiMocks = vi.hoisted(() => ({
  previewSession: vi.fn(),
  imRunSelectionAction: vi.fn()
}));

vi.mock("../../bridge", () => ({ desktopApi: () => apiMocks }));
vi.mock("../../i18n", () => ({
  useI18n: () => ({ locale: "en", t: (key: string) => key })
}));

const renderCounts: Record<string, number> = {};

vi.mock("../../components/StreamdownRenderer", () => ({
  StreamdownRenderer: (props: { content: string }) => {
    const key = props.content.slice(0, 24);
    renderCounts[key] = (renderCounts[key] || 0) + 1;
    return React.createElement("div", { className: "fake-md" }, props.content);
  }
}));

const { SessionTranscriptPane } = await import("./SessionTranscriptPane");

afterEach(() => {
  cleanup();
  apiMocks.previewSession.mockReset();
});

describe("render counting", () => {
  it("counts markdown renders on live updates", async () => {
    let preview = {
      title: "Live",
      messages: [
        { role: "user", text: "first user question" },
        { role: "assistant", text: "first assistant answer" },
        { role: "user", text: "second user question" },
        { role: "assistant", text: "streaming start" }
      ]
    };
    apiMocks.previewSession.mockImplementation(async () => ({
      session: { provider: "codex", id: "s" },
      preview
    }));

    render(<SessionTranscriptPane provider="codex" sessionId="s" active isRunning />);
    await waitFor(() => expect(document.querySelector(".fake-md")).toBeTruthy());
    await new Promise((resolve) => setTimeout(resolve, 50));

    preview = {
      title: "Live",
      messages: [
        { role: "user", text: "first user question" },
        { role: "assistant", text: "first assistant answer" },
        { role: "user", text: "second user question" },
        { role: "assistant", text: "streaming start token 2" }
      ]
    };

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 700));
    });

    console.log("RENDER COUNTS", JSON.stringify(renderCounts, null, 2));
    expect(renderCounts["streaming start"] || 0).toBeLessThanOrEqual(2);
  });
});
