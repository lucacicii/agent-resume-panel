import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const renderCounts = vi.hoisted(() => new Map<string, number>());

// Counts one render per markdown body the pane hands to the renderer, so a
// live poll that rebuilds untouched rows shows up as extra renders.
vi.mock("../../components/StreamdownRenderer", async (importOriginal) => {
  const { createElement } = await import("react");
  const actual = await importOriginal<typeof import("../../components/StreamdownRenderer")>();
  return {
    ...actual,
    StreamdownRenderer: (props: Parameters<typeof actual.StreamdownRenderer>[0]): React.ReactNode => {
      renderCounts.set(props.content, (renderCounts.get(props.content) ?? 0) + 1);
      return createElement(actual.StreamdownRenderer, props);
    }
  };
});

const { SessionTranscriptPane } = await import("./SessionTranscriptPane");

const apiMocks = vi.hoisted(() => ({
  previewSession: vi.fn(),
  imRunSelectionAction: vi.fn()
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
  apiMocks.imRunSelectionAction.mockReset();
  renderCounts.clear();
  try {
    Reflect.deleteProperty(navigator, "clipboard");
  } catch {
    // Clipboard stays undefined in environments without it.
  }
});

describe("SessionTranscriptPane", () => {
  it("asks the user to open a session when no identity is bound", () => {
    render(<SessionTranscriptPane provider="" sessionId="" active />);
    expect(screen.getByText("desktop.workbench.transcriptNeedSession")).toBeTruthy();
    expect(apiMocks.previewSession).not.toHaveBeenCalled();
  });

  it("shows the new session hint when the session is pending", () => {
    render(<SessionTranscriptPane provider="codex" sessionId="" isPending active />);
    expect(screen.getByText("desktop.workbench.transcriptNewSessionHint")).toBeTruthy();
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

  it("scrolls to a composer tip that is only a suffix of the user message", async () => {
    apiMocks.previewSession.mockResolvedValue({
      session: { provider: "codex", id: "session-1" },
      preview: {
        title: "Fix renderer",
        messages: [
          { role: "user", text: "./shot.png please inspect src" },
          { role: "assistant", text: "Looking." }
        ]
      }
    });
    const scrollIntoView = vi.fn();
    const original = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = scrollIntoView;
    render(<SessionTranscriptPane
      provider="codex"
      sessionId="session-1"
      active
      focusUserMessage={{ text: "please inspect src", nonce: 1 }}
    />);
    await screen.findByRole("button", { name: /please inspect src/ });
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledWith({ block: "start" }));
    expect(document.querySelector('[data-transcript-id="transcript-msg-0"]')?.className).toContain("is-selected");
    HTMLElement.prototype.scrollIntoView = original;
  });

  it("searches markdown content without hiding messages and supports match navigation", async () => {
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
    const searchInput = screen.getByRole("searchbox") as HTMLInputElement;

    // Cmd+F focuses search input
    fireEvent.keyDown(window, { key: "f", metaKey: true });
    expect(document.activeElement).toBe(searchInput);

    // Typing query finds matches without hiding messages
    fireEvent.change(searchInput, { target: { value: "original" } });
    expect(screen.getByText("A content minimap will not work.")).toBeTruthy();
    expect(screen.getAllByText(/Show the original transcript instead/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("1/1")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Add a minimap/ })).toBeTruthy();
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
    expect((document.querySelector(".wb-transcript-body") as HTMLElement | null)?.style.getPropertyValue("--wb-transcript-font-size")).toBe("14px");
    expect(screen.queryByText("Use **bold** text.")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "desktop.workbench.transcriptShowOriginal" }));
    expect(screen.getByText("Use **bold** text.")).toBeTruthy();
    expect(document.querySelector(".wb-transcript-md")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "desktop.workbench.transcriptShowMarkdown" }));
    expect(document.querySelector(".wb-transcript-md strong")?.textContent).toBe("bold");
  });

  it("applies the configured transcript markdown font size", async () => {
    apiMocks.previewSession.mockResolvedValue({
      session: { provider: "codex", id: "session-md" },
      preview: {
        title: "Markdown",
        messages: [{ role: "assistant", text: "Use **bold** text." }]
      }
    });
    render(<SessionTranscriptPane provider="codex" sessionId="session-md" active fontSize={18} />);
    expect(await screen.findByRole("button", { name: "desktop.workbench.transcriptShowOriginal" })).toBeTruthy();
    expect((document.querySelector(".wb-transcript-body") as HTMLElement | null)?.style.getPropertyValue("--wb-transcript-font-size")).toBe("18px");
  });

  it("keeps thinking collapsed behind a rolling reel until the user expands it", async () => {
    apiMocks.previewSession.mockResolvedValue({
      session: { provider: "claude", id: "session-think" },
      preview: {
        title: "Think",
        messages: [{
          role: "assistant",
          text: "The folder is empty because git drops it.",
          thinking: "Inspect status parsing.\nThen check the git folder."
        }]
      }
    });
    render(<SessionTranscriptPane provider="claude" sessionId="session-think" active />);
    const toggle = await screen.findByRole("button", { name: "desktop.workbench.transcriptThinking" });
    expect(screen.getByText("The folder is empty because git drops it.")).toBeTruthy();

    // Collapsed: no markdown body, but the reel previews the newest line.
    expect(document.querySelector(".wb-transcript-thinking-body")).toBeNull();
    const reelLines = [...document.querySelectorAll(".wb-thinking-ticker-line")].map((node) => node.textContent);
    expect(reelLines).toEqual(["Then check the git folder."]);
    expect(document.querySelector(".wb-thinking-ticker")?.getAttribute("aria-hidden")).toBe("true");

    fireEvent.click(toggle);
    // Expanded: the full reasoning renders and the reel steps aside.
    expect(document.querySelector(".wb-thinking-ticker")).toBeNull();
    expect(document.querySelector(".wb-transcript-thinking-body")?.textContent)
      .toContain("Inspect status parsing.");
    expect(document.querySelector(".wb-transcript-thinking-body")?.textContent)
      .toContain("Then check the git folder.");
  });

  it("keeps the newest reasoning in view while the expanded window streams", async () => {
    let preview = {
      title: "Think",
      messages: [
        { role: "user", text: "Why is the folder missing?" },
        { role: "assistant", text: "", thinking: "Inspect status parsing." }
      ]
    };
    apiMocks.previewSession.mockImplementation(async () => ({
      session: { provider: "claude", id: "session-think-stream" },
      preview
    }));

    render(<SessionTranscriptPane provider="claude" sessionId="session-think-stream" active isRunning />);
    fireEvent.click(await screen.findByRole("button", { name: "desktop.workbench.transcriptThinking" }));
    const body = document.querySelector(".wb-transcript-thinking-body") as HTMLElement;
    expect(body.className).toContain("is-streaming");

    let scrollTop = 0;
    Object.defineProperty(body, "scrollHeight", { configurable: true, get: () => 400 });
    Object.defineProperty(body, "scrollTop", {
      configurable: true,
      get: () => scrollTop,
      set: (value: number) => { scrollTop = value; }
    });

    preview = {
      title: "Think",
      messages: [
        { role: "user", text: "Why is the folder missing?" },
        { role: "assistant", text: "", thinking: "Inspect status parsing.\nThen check the git folder." }
      ]
    };

    await waitFor(
      () => expect(document.querySelector(".wb-transcript-thinking-body")?.textContent)
        .toContain("Then check the git folder."),
      { timeout: 3500 }
    );
    expect(scrollTop).toBe(400);
  });

  it("reloads transcript when clicking the refresh button", async () => {
    let preview = {
      title: "Fix renderer",
      messages: [{ role: "user", text: "Add a transcript pane" }]
    };
    apiMocks.previewSession.mockImplementation(async () => ({
      session: { provider: "codex", id: "session-1" },
      preview
    }));
    render(<SessionTranscriptPane provider="codex" sessionId="session-1" active />);
    expect(await screen.findByRole("button", { name: /Add a transcript pane/ })).toBeTruthy();
    expect(apiMocks.previewSession).toHaveBeenCalledTimes(1);

    preview = {
      title: "Fix renderer",
      messages: [
        { role: "user", text: "Add a transcript pane" },
        { role: "assistant", text: "Added manually." }
      ]
    };

    const refreshBtn = screen.getByRole("button", { name: "desktop.common.refresh" });
    await act(async () => {
      fireEvent.click(refreshBtn);
    });

    expect(await screen.findByText("Added manually.")).toBeTruthy();
    expect(apiMocks.previewSession).toHaveBeenCalledTimes(2);
  });

  it("renders table inside markdown-body", async () => {
    const tableMarkdown = "| Col 1 | Col 2 |\n| --- | --- |\n| Val 1 | Val 2 |";
    apiMocks.previewSession.mockResolvedValue({
      session: { provider: "codex", id: "session-table" },
      preview: {
        title: "Table Preview",
        messages: [{ role: "assistant", text: tableMarkdown }]
      }
    });

    render(<SessionTranscriptPane provider="codex" sessionId="session-table" active />);
    expect(await screen.findByRole("button", { name: "desktop.workbench.transcriptShowOriginal" })).toBeTruthy();
    const table = document.querySelector(".wb-transcript-body table") as HTMLElement;
    expect(table).toBeTruthy();
    expect(table.textContent).toContain("Col 1");
    expect(table.textContent).toContain("Val 1");
  });

  it("silently synchronizes live preview when isRunning is true", async () => {
    let preview = {
      title: "Live",
      messages: [{ role: "assistant", text: "Starting..." }]
    };
    apiMocks.previewSession.mockImplementation(async () => ({
      session: { provider: "codex", id: "session-live" },
      preview
    }));

    render(<SessionTranscriptPane provider="codex" sessionId="session-live" active isRunning />);
    expect(await screen.findByText("Starting...")).toBeTruthy();
    expect(apiMocks.previewSession).toHaveBeenCalledTimes(1);

    preview = {
      title: "Live",
      messages: [{ role: "assistant", text: "Starting... token 1" }]
    };

    await waitFor(() => expect(apiMocks.previewSession.mock.calls.length).toBeGreaterThan(1), { timeout: 3500 });
    await waitFor(() => expect(document.querySelector(".wb-transcript-body")?.textContent).toContain("Starting... token 1"));
  });

  it("only re-renders markdown for the message that changed on a live poll", async () => {
    const messages = [
      { role: "user", text: "First question stays stable." },
      { role: "assistant", text: "First answer stays stable." },
      { role: "user", text: "Second question stays stable." },
      { role: "assistant", text: "Streaming answer begins" }
    ];
    let preview = { title: "Live", messages };
    apiMocks.previewSession.mockImplementation(async () => ({
      session: { provider: "codex", id: "session-parse" },
      preview
    }));

    render(<SessionTranscriptPane provider="codex" sessionId="session-parse" active isRunning />);
    await screen.findByRole("button", { name: /First question stays stable/ });
    expect(screen.getByText("First answer stays stable.")).toBeTruthy();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });

    const stableTexts = messages.slice(0, 3).map((message) => message.text);
    const stableCounts = stableTexts.map((text) => renderCounts.get(text) ?? 0);
    expect(stableCounts.every((count) => count > 0)).toBe(true);

    preview = {
      title: "Live",
      messages: [
        ...messages.slice(0, 3),
        { role: "assistant", text: "Streaming answer begins and grows" }
      ]
    };

    await waitFor(
      () => expect(document.querySelector(".wb-transcript-body")?.textContent)
        .toContain("Streaming answer begins and grows"),
      { timeout: 3500 }
    );

    // Untouched messages keep their rendered markdown; only the message that
    // received new content goes through the renderer again.
    const stableCountsAfter = stableTexts.map((text) => renderCounts.get(text) ?? 0);
    expect(stableCountsAfter).toEqual(stableCounts);
    expect(renderCounts.get("Streaming answer begins and grows") ?? 0).toBeGreaterThan(0);
  });

  it("does not fetch while inactive", async () => {
    render(<SessionTranscriptPane provider="codex" sessionId="session-1" active={false} />);
    await act(async () => undefined);
    expect(apiMocks.previewSession).not.toHaveBeenCalled();
  });

  it("copies a message text via the per-message copy action", async () => {
    apiMocks.previewSession.mockResolvedValue({
      session: { provider: "codex", id: "session-copy" },
      preview: {
        title: "Copy",
        messages: [
          { role: "user", text: "Add a transcript pane" },
          { role: "assistant", text: "Dock it beside the TUI." }
        ]
      }
    });
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

    render(<SessionTranscriptPane provider="codex" sessionId="session-copy" active />);
    await screen.findByText("Dock it beside the TUI.");
    const row = document.querySelector('[data-transcript-id="transcript-msg-1"]') as HTMLElement;
    const copyBtn = row.querySelector('button[aria-label="desktop.common.copy"]') as HTMLButtonElement;
    expect(copyBtn).toBeTruthy();
    fireEvent.click(copyBtn);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("Dock it beside the TUI."));
  });

  it("translates a message inline and restores the original via the action chip", async () => {
    apiMocks.previewSession.mockResolvedValue({
      session: { provider: "codex", id: "session-tr" },
      preview: {
        title: "Translate",
        messages: [{ role: "assistant", text: "Dock it beside the TUI." }]
      }
    });
    apiMocks.imRunSelectionAction.mockResolvedValue({ text: "translated body" });

    render(<SessionTranscriptPane provider="codex" sessionId="session-tr" active />);
    expect(await screen.findByText("Dock it beside the TUI.")).toBeTruthy();
    const row = document.querySelector('[data-transcript-id="transcript-msg-0"]') as HTMLElement;
    const translateBtn = row.querySelector('button[aria-label="desktop.workbench.transcriptTranslate"]') as HTMLButtonElement;
    expect(translateBtn).toBeTruthy();
    fireEvent.click(translateBtn);

    await waitFor(() => expect(apiMocks.imRunSelectionAction).toHaveBeenCalledWith({
      actionId: "translate",
      text: "Dock it beside the TUI."
    }));
    expect(await screen.findByText("translated body")).toBeTruthy();
    expect(screen.queryByText("Dock it beside the TUI.")).toBeNull();

    const restoreBtn = row.querySelector('button[aria-label="desktop.workbench.transcriptRestore"]') as HTMLButtonElement;
    expect(restoreBtn).toBeTruthy();
    fireEvent.click(restoreBtn);
    await waitFor(() => expect(screen.queryByText("translated body")).toBeNull());
    expect(screen.getByText("Dock it beside the TUI.")).toBeTruthy();
    expect(apiMocks.imRunSelectionAction).toHaveBeenCalledTimes(1);
  });

  it("shows an optimistic user bubble and waiting assistant while the disk transcript lags", async () => {
    apiMocks.previewSession.mockResolvedValue({
      session: { provider: "codex", id: "session-pending" },
      preview: {
        title: "Live",
        messages: [
          { role: "user", text: "Add a transcript pane" },
          { role: "assistant", text: "Dock it beside the TUI." }
        ]
      }
    });

    render(<SessionTranscriptPane
      provider="codex"
      sessionId="session-pending"
      active
      isRunning
      pendingUserMessage={{ text: "Keep the terminal visible.", sentAtMs: Date.now() }}
    />);

    expect(await screen.findByRole("button", { name: /Keep the terminal visible/ })).toBeTruthy();
    expect(document.querySelector('[data-transcript-id="transcript-pending-user"]')?.textContent).toContain("Keep the terminal visible.");
    expect(document.querySelector('[data-transcript-id="transcript-pending-assistant"]')?.textContent).toContain("desktop.workbench.transcriptWorking");
    expect(screen.getByRole("button", { name: /desktop.workbench.transcriptWorking/ })).toBeTruthy();
    expect(document.querySelector(".wb-transcript-pending-body .im-jumping-dots")).toBeTruthy();
  });

  it("surfaces a translate failure in the transcript status", async () => {
    apiMocks.previewSession.mockResolvedValue({
      session: { provider: "codex", id: "session-err" },
      preview: {
        title: "Error",
        messages: [{ role: "assistant", text: "Dock it beside the TUI." }]
      }
    });
    apiMocks.imRunSelectionAction.mockRejectedValue(new Error("Conversation LLM is not configured."));

    render(<SessionTranscriptPane provider="codex" sessionId="session-err" active />);
    expect(await screen.findByText("Dock it beside the TUI.")).toBeTruthy();
    const row = document.querySelector('[data-transcript-id="transcript-msg-0"]') as HTMLElement;
    const translateBtn = row.querySelector('button[aria-label="desktop.workbench.transcriptTranslate"]') as HTMLButtonElement;
    fireEvent.click(translateBtn);
    await waitFor(() => expect(screen.getByText("Conversation LLM is not configured.")).toBeTruthy());
  });
});
