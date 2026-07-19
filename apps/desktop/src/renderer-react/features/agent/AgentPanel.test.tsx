import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentStreamEvent, AgentThread } from "@agent-resume/core";
import { I18nProvider } from "../../i18n";
import { AgentPanel } from "./AgentPanel";

const thread: AgentThread = { id: "thread-1", title: "Renderer work", createdAtMs: 1, updatedAtMs: 1 };

afterEach(() => { cleanup(); document.getElementById("react-agent")?.remove(); localStorage.removeItem("activeAgentThreadId"); });

describe("AgentPanel", () => {
  it("loads a thread and sends a streamed Agent request", async () => {
    const host = document.createElement("div"); host.id = "react-agent"; document.body.append(host);
    let stream: ((event: { phase: "chunk"; delta: string }) => void) | undefined;
    let resolveAsk: ((value: { answer: string; citations: []; fallback: boolean; digests: [] }) => void) | undefined;
    const askAgent = vi.fn(() => new Promise<{ answer: string; citations: []; fallback: boolean; digests: [] }>((resolve) => { resolveAsk = resolve; }));
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages: { "desktop.agent.newThread": "New chat", "desktop.agent.newChat": "New chat", "desktop.agent.deleteThreadTitle": "Delete chat", "desktop.agent.renameChat": "Rename", "desktop.agent.audit": "Trace", "desktop.agent.deleteChat": "Delete chat", "desktop.agent.emptyChat": "Start a conversation", "desktop.agent.emptyHint": "Ask about reports", "desktop.agent.inputPlaceholder": "Type a message", "desktop.agent.searchingReports": "Searching", "desktop.agent.statusGenerating": "Generating", "desktop.agent.completeDone": "Done · {0} sources{1}", "desktop.agent.completeFallback": "Done", "desktop.agent.completeToolCalls": " · {0} tools", "desktop.agent.typing": "Typing", "desktop.agent.recentSummary": "Recent summary", "desktop.agent.reportRetrieval": "Memory retrieval", "desktop.agent.citationReports": "Reports", "desktop.agent.citationNotes": "Notes", "desktop.agent.loadOlder": "Load older", "desktop.agent.renameDialogTitle": "Rename chat", "desktop.agent.deleteConfirmSimple": "Delete {0}?", "desktop.agent.auditTitle": "Trace", "desktop.agent.auditEmpty": "No trace", "desktop.agent.auditUnspecifiedNote": "Untitled", "desktop.common.copy": "Copy", "desktop.common.send": "Send", "desktop.common.cancel": "Cancel", "desktop.common.confirm": "Confirm", "desktop.common.refresh": "Refresh", "desktop.tabs.agent": "Agent", "desktop.common.loading": "Loading" } }),
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
});
