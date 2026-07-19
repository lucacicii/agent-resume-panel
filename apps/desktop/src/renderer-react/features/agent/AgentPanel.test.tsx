import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentStreamEvent, AgentThread } from "@agent-resume/core";
import { I18nProvider } from "../../i18n";
import { AgentPanel } from "./AgentPanel";

const thread: AgentThread = { id: "thread-1", title: "Renderer work", createdAtMs: 1, updatedAtMs: 1 };

afterEach(() => { cleanup(); document.getElementById("react-agent")?.remove(); localStorage.removeItem("activeAgentThreadId"); localStorage.removeItem("askSidebarCollapsed"); localStorage.removeItem("sidebar-folders-width"); });

const messages = {
  "desktop.agent.newThread": "New chat", "desktop.agent.newChat": "New chat", "desktop.agent.deleteThreadTitle": "Delete chat", "desktop.agent.renameChat": "Rename", "desktop.agent.audit": "Trace", "desktop.agent.deleteChat": "Delete chat", "desktop.agent.emptyChat": "Start a conversation", "desktop.agent.emptyHint": "Ask about reports", "desktop.agent.inputPlaceholder": "Type a message", "desktop.agent.searchingReports": "Searching", "desktop.agent.statusGenerating": "Generating", "desktop.agent.completeDone": "Done · {0} sources{1}", "desktop.agent.completeFallback": "Done", "desktop.agent.completeToolCalls": " · {0} tools", "desktop.agent.typing": "Typing", "desktop.agent.recentSummary": "Recent summary", "desktop.agent.reportRetrieval": "Memory retrieval", "desktop.agent.citationReports": "Reports", "desktop.agent.citationNotes": "Notes", "desktop.agent.loadOlder": "Load older", "desktop.agent.renameDialogTitle": "Rename chat", "desktop.agent.deleteConfirmSimple": "Delete {0}?", "desktop.agent.auditTitle": "Trace", "desktop.agent.auditEmpty": "No trace", "desktop.agent.auditUnspecifiedNote": "Untitled", "desktop.agent.indexingNotes": "Indexing notes", "desktop.agent.citationHover": "Hover to preview", "desktop.agent.citationRef": "Citation", "desktop.agent.citationNoPreview": "No preview{0}", "desktop.agent.openInNotes": "Open in Notes", "desktop.agent.openInReport": "Open in Memory", "desktop.agent.noteDeleted": "Note deleted", "desktop.agent.cannotResolveNote": "Cannot resolve note", "desktop.agent.cannotResolveReport": "Cannot resolve report", "desktop.agent.resizeSidebar": "Resize sidebar", "desktop.agent.toolsOn": "Tools on", "desktop.agent.toolsOffTitle": "Tools off", "desktop.agent.toolsToggle": "Tools toggle", "desktop.agent.toolsOnStatus": "Tools enabled", "desktop.agent.toolsOffStatus": "Tools disabled", "desktop.agent.callingTool": "Calling {0}", "desktop.agent.executingTool": "Executing {0}", "desktop.agent.copied": "Copied", "desktop.agent.copiedAnswer": "Answer copied", "desktop.agent.createFailedPrefix": "Create failed: {0}", "desktop.agent.loadThreadsFailedPrefix": "Load failed: {0}", "desktop.agent.loadChatFailedPrefix": "Load chat failed: {0}", "desktop.agent.loadOlderFailedPrefix": "Load older failed: {0}", "desktop.agent.deleteFailedPrefix": "Delete failed: {0}", "desktop.agent.renameFailedPrefix": "Rename failed: {0}", "desktop.agent.auditLoading": "Loading trace", "desktop.common.copy": "Copy", "desktop.common.resend": "Resend", "desktop.common.send": "Send", "desktop.common.cancel": "Cancel", "desktop.common.confirm": "Confirm", "desktop.common.refresh": "Refresh", "desktop.common.loading": "Loading", "desktop.common.hideSidebar": "Hide sidebar", "desktop.common.showSidebar": "Show sidebar", "desktop.tabs.agent": "Agent"
};

describe("AgentPanel", () => {
  it("loads a thread and sends a streamed Agent request", async () => {
    const host = document.createElement("div"); host.id = "react-agent"; document.body.append(host);
    let stream: ((event: { phase: "chunk"; delta: string }) => void) | undefined;
    let resolveAsk: ((value: { answer: string; citations: []; fallback: boolean; digests: [] }) => void) | undefined;
    const askAgent = vi.fn(() => new Promise<{ answer: string; citations: []; fallback: boolean; digests: [] }>((resolve) => { resolveAsk = resolve; }));
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages }),
      onLocaleChanged: () => () => undefined,
      listAgentThreads: async () => [thread],
      listAgentChat: async () => ({ messages: [{ id: "m-1", role: "assistant", content: "Saved answer", createdAtMs: 1, sortOrder: 1 }], hasMore: false }),
      listOlderAgentChat: async () => ({ messages: [], hasMore: false }),
      askAgent,
      onAskStream: (callback: (event: AgentStreamEvent) => void) => { stream = callback as typeof stream; return () => undefined; },
      renameAgentThread: async () => ({ ok: true }),
      createAgentThread: async () => thread,
      deleteAgentThread: async () => ({ ok: true }),
      cancelAskAgent: async () => ({ ok: true })
    } as unknown as typeof window.agentResume;
    render(<I18nProvider><AgentPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "agent" })));
    await screen.findByText("Saved answer");
    const input = screen.getByPlaceholderText("Type a message");
    fireEvent.change(input, { target: { value: "Summarize this" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await act(async () => stream?.({ phase: "chunk", delta: "Partial" }));
    await screen.findByText("Partial");
    await waitFor(() => expect(askAgent).toHaveBeenCalledWith(expect.objectContaining({ query: "Summarize this", threadId: "thread-1", enableTools: true })));
    await act(async () => resolveAsk?.({ answer: "Completed response", citations: [], fallback: false, digests: [] }));
    await screen.findByText("Completed response");
  });

  it("persists the sidebar state and clears messages without deleting the thread", async () => {
    const host = document.createElement("div"); host.id = "react-agent"; document.body.append(host);
    const clearAgentChat = vi.fn(async () => ({ ok: true }));
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages }), onLocaleChanged: () => () => undefined,
      listAgentThreads: async () => [thread], listAgentChat: async () => ({ messages: [{ id: "m-1", role: "assistant", content: "Saved answer", createdAtMs: 1, sortOrder: 1 }], hasMore: false }), listOlderAgentChat: async () => ({ messages: [], hasMore: false }), clearAgentChat,
      createAgentThread: async () => thread, deleteAgentThread: async () => ({ ok: true }), renameAgentThread: async () => ({ ok: true }), askAgent: async () => ({ answer: "", citations: [], fallback: false, digests: [] }), cancelAskAgent: async () => ({ ok: true }), onAskStream: () => () => undefined
    } as unknown as typeof window.agentResume;
    render(<I18nProvider><AgentPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "agent" })));
    await screen.findByText("Saved answer");
    fireEvent.click(screen.getByRole("button", { name: "Hide sidebar" }));
    expect(localStorage.getItem("askSidebarCollapsed")).toBe("1");
    expect(screen.getByRole("button", { name: "Show sidebar" }).getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(screen.getByText("Delete chat"));
    await waitFor(() => expect(clearAgentChat).toHaveBeenCalledWith({ threadId: "thread-1" }));
    expect(screen.getByText("Start a conversation")).toBeTruthy();
  });

  it("shows indexing progress and previews report citations", async () => {
    const host = document.createElement("div"); host.id = "react-agent"; document.body.append(host);
    let indexProgress: ((event: { phase: "indexing"; message: string; current: number; total: number }) => void) | undefined;
    const getReportEntry = vi.fn(async () => ({ id: "daily:2026-07-19", title: "Daily", content: "Preview body" }));
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages }), onLocaleChanged: () => () => undefined,
      listAgentThreads: async () => [thread], listAgentChat: async () => ({ messages: [{ id: "m-1", role: "assistant", content: "Saved answer", createdAtMs: 1, sortOrder: 1, citations: [{ index: 1, reportId: "daily:2026-07-19", level: "daily", title: "Daily" }] }], hasMore: false }), listOlderAgentChat: async () => ({ messages: [], hasMore: false }),
      onNotesIndexProgress: (callback: typeof indexProgress) => { indexProgress = callback; return () => undefined; }, getReportEntry,
      createAgentThread: async () => thread, deleteAgentThread: async () => ({ ok: true }), renameAgentThread: async () => ({ ok: true }), askAgent: async () => ({ answer: "", citations: [], fallback: false, digests: [] }), cancelAskAgent: async () => ({ ok: true }), onAskStream: () => () => undefined, clearAgentChat: async () => ({ ok: true })
    } as unknown as typeof window.agentResume;
    render(<I18nProvider><AgentPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "agent" })));
    await screen.findByText("Saved answer");
    await act(async () => indexProgress?.({ phase: "indexing", message: "Indexing notes", current: 1, total: 2 }));
    expect(screen.getByText("1/2")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reports (1)" }));
    const citation = screen.getByRole("button", { name: /\[1\] daily · Daily/ });
    fireEvent.mouseEnter(citation);
    await screen.findByText("Preview body");
    expect(getReportEntry).toHaveBeenCalledWith("daily:2026-07-19");
  });
});
