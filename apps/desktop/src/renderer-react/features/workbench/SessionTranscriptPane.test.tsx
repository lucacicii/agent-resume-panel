import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionTranscriptPane } from "./SessionTranscriptPane";

const apiMocks = vi.hoisted(() => ({
  previewSession: vi.fn()
}));

vi.mock("../../bridge", () => ({ desktopApi: () => apiMocks }));
vi.mock("../../i18n", () => ({
  useI18n: () => ({
    locale: "en",
    t: (key: string) => key
  })
}));

afterEach(() => {
  cleanup();
  apiMocks.previewSession.mockReset();
});

describe("SessionTranscriptPane", () => {
  it("asks the user to open a session when no identity is bound", () => {
    render(<SessionTranscriptPane provider="" sessionId="" active />);
    expect(screen.getByText("desktop.workbench.transcriptNeedSession")).toBeTruthy();
    expect(apiMocks.previewSession).not.toHaveBeenCalled();
  });

  it("renders a user outline and scrolls the matching message without touching xterm", async () => {
    apiMocks.previewSession.mockResolvedValue({
      session: { provider: "codex", id: "session-1" },
      preview: {
        title: "Fix renderer",
        messages: [
          { role: "user", text: "Add a transcript pane" },
          { role: "assistant", text: "Dock it beside the TUI." },
          { role: "user", text: "Keep the terminal visible." }
        ]
      }
    });
    const scrollIntoView = vi.fn();
    const original = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = scrollIntoView;

    render(<SessionTranscriptPane provider="codex" sessionId="session-1" active />);
    expect(await screen.findByRole("button", { name: /Add a transcript pane/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Keep the terminal visible/ })).toBeTruthy();
    const roleIcons = [...document.querySelectorAll(".wb-transcript-role-icon")];
    expect(roleIcons).toHaveLength(3);
    expect(roleIcons.filter((node) => node.getAttribute("data-theme-icon") === "user")).toHaveLength(2);
    expect(roleIcons.filter((node) => node.tagName === "IMG")).toHaveLength(1);
    expect(document.querySelector('[data-transcript-id="transcript-msg-1"]')?.textContent).toContain("Dock it beside the TUI.");
    expect(apiMocks.previewSession).toHaveBeenCalledWith({ provider: "codex", id: "session-1" });

    fireEvent.click(screen.getByRole("button", { name: /Keep the terminal visible/ }));
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "start" });
    HTMLElement.prototype.scrollIntoView = original;
  });

  it("filters outline and body together", async () => {
    apiMocks.previewSession.mockResolvedValue({
      session: { provider: "claude", id: "session-2" },
      preview: {
        title: "Review",
        messages: [
          { role: "user", text: "Add a minimap" },
          { role: "assistant", text: "A content minimap will not work." },
          { role: "user", text: "Show the original transcript instead." }
        ]
      }
    });
    render(<SessionTranscriptPane provider="claude" sessionId="session-2" active />);
    await screen.findByRole("button", { name: /Add a minimap/ });
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "original" } });
    expect(screen.getByRole("button", { name: /Show the original transcript instead/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Add a minimap/ })).toBeNull();
    expect(screen.queryByText("A content minimap will not work.")).toBeNull();
  });

  it("shows warning, truncated, and empty states from the preview payload", async () => {
    apiMocks.previewSession.mockResolvedValue({
      session: { provider: "codex", id: "empty" },
      preview: {
        title: "Empty",
        messages: [],
        truncated: true,
        warning: "Transcript is still flushing to disk."
      }
    });
    render(<SessionTranscriptPane provider="codex" sessionId="empty" active />);
    expect(await screen.findByText("desktop.sessions.noMessages")).toBeTruthy();
    expect(screen.getByText("desktop.sessions.truncated")).toBeTruthy();
    expect(screen.getByText("Transcript is still flushing to disk.")).toBeTruthy();
  });

  it("toggles original text and rendered Markdown", async () => {
    apiMocks.previewSession.mockResolvedValue({
      session: { provider: "codex", id: "session-md" },
      preview: {
        title: "Markdown",
        messages: [{ role: "assistant", text: "Use **bold** text." }]
      }
    });
    render(<SessionTranscriptPane provider="codex" sessionId="session-md" active />);
    expect(await screen.findByRole("button", { name: "desktop.workbench.transcriptShowOriginal" })).toBeTruthy();
    expect(document.querySelector(".wb-transcript-md strong")?.textContent).toBe("bold");
    expect(screen.queryByText("Use **bold** text.")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "desktop.workbench.transcriptShowOriginal" }));
    expect(screen.getByText("Use **bold** text.")).toBeTruthy();
    expect(document.querySelector(".wb-transcript-md")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "desktop.workbench.transcriptShowMarkdown" }));
    expect(document.querySelector(".wb-transcript-md strong")?.textContent).toBe("bold");
  });

  it("keeps thinking collapsed until the user expands it", async () => {
    apiMocks.previewSession.mockResolvedValue({
      session: { provider: "claude", id: "session-think" },
      preview: {
        title: "Think",
        messages: [{
          role: "assistant",
          text: "The folder is empty because git drops it.",
          thinking: "Inspect status parsing."
        }]
      }
    });
    render(<SessionTranscriptPane provider="claude" sessionId="session-think" active />);
    expect(await screen.findByRole("button", { name: "desktop.workbench.transcriptThinking" })).toBeTruthy();
    expect(screen.queryByText("Inspect status parsing.")).toBeNull();
    expect(screen.getByText("The folder is empty because git drops it.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "desktop.workbench.transcriptThinking" }));
    expect(screen.getByText("Inspect status parsing.")).toBeTruthy();
  });

  it("silently refreshes an active transcript on the auto-refresh interval", async () => {
    apiMocks.previewSession.mockResolvedValue({
      session: { provider: "codex", id: "session-1" },
      preview: { title: "Fix renderer", messages: [{ role: "user", text: "Add a transcript pane" }] }
    });
    render(<SessionTranscriptPane provider="codex" sessionId="session-1" active autoRefreshMs={20} />);
    expect(await screen.findByRole("button", { name: /Add a transcript pane/ })).toBeTruthy();
    expect(apiMocks.previewSession).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(apiMocks.previewSession.mock.calls.length).toBeGreaterThan(1));
  });

  it("does not fetch while inactive", async () => {
    render(<SessionTranscriptPane provider="codex" sessionId="session-1" active={false} />);
    await act(async () => undefined);
    expect(apiMocks.previewSession).not.toHaveBeenCalled();
  });
});
