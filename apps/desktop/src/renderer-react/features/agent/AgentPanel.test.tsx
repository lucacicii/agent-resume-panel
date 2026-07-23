import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentStreamEvent, AgentThread } from "@agent-resume/core";
import { I18nProvider } from "../../i18n";
import { AgentPanel } from "./AgentPanel";

const thread: AgentThread = { id: "thread-1", title: "Renderer work", createdAtMs: 1, updatedAtMs: 1 };

afterEach(() => { cleanup(); document.getElementById("react-agent")?.remove(); localStorage.removeItem("activeAgentThreadId"); localStorage.removeItem("askSidebarCollapsed"); localStorage.removeItem("sidebar-folders-width"); });

const messages = {
  "desktop.agent.newThread": "New chat", "desktop.agent.newChat": "New chat", "desktop.agent.deleteThreadTitle": "Delete chat", "desktop.agent.renameChat": "Rename", "desktop.agent.audit": "Trace", "desktop.agent.deleteChat": "Delete chat", "desktop.agent.emptyChat": "Start a conversation", "desktop.agent.emptyHint": "Ask about reports", "desktop.agent.inputPlaceholder": "Type a message", "desktop.agent.searchingReports": "Searching", "desktop.agent.statusGenerating": "Generating", "desktop.agent.completeDone": "Done · {0} sources{1}", "desktop.agent.completeFallback": "Done", "desktop.agent.completeToolCalls": " · {0} tools", "desktop.agent.typing": "Typing", "desktop.agent.recentSummary": "Recent summary", "desktop.agent.reportRetrieval": "Memory retrieval", "desktop.agent.citationReports": "Reports", "desktop.agent.citationNotes": "Notes", "desktop.agent.citationSessions": "Sessions", "desktop.agent.sessionLevel": "Session", "desktop.agent.openInSessions": "Open in Sessions", "desktop.agent.resumeSession": "Resume", "desktop.agent.resumeStarted": "Resume started: {0} {1}", "desktop.agent.cannotResolveSession": "Cannot resolve session", "desktop.agent.loadOlder": "Load older", "desktop.agent.renameDialogTitle": "Rename chat", "desktop.agent.deleteConfirmSimple": "Delete {0}?", "desktop.agent.auditTitle": "Trace", "desktop.agent.auditEmpty": "No trace", "desktop.agent.auditUnspecifiedNote": "Untitled", "desktop.agent.indexingNotes": "Indexing notes", "desktop.agent.citationRef": "Citation", "desktop.agent.citationsTitle": "Citations", "desktop.agent.citationsDescription": "Sources used for this answer.", "desktop.agent.citationsEmpty": "No sources", "desktop.agent.citationContent": "Content", "desktop.agent.citationField.source": "Source", "desktop.agent.citationField.level": "Level", "desktop.agent.citationField.operation": "Operation", "desktop.agent.citationField.score": "Score", "desktop.agent.citationField.reportId": "Report ID", "desktop.agent.citationField.noteId": "Note ID", "desktop.agent.citationField.path": "Path", "desktop.agent.citationField.scope": "Scope", "desktop.agent.citationField.heading": "Heading", "desktop.agent.citationField.period": "Source time", "desktop.agent.citationField.session": "Related session", "desktop.agent.citationNoPreview": "No preview{0}", "desktop.agent.previewLoadFailed": "Preview failed: {0}", "desktop.agent.openInNotes": "Open in Notes", "desktop.agent.openInReport": "Open in Memory", "desktop.agent.noteDeleted": "Note deleted", "desktop.agent.cannotResolveNote": "Cannot resolve note", "desktop.agent.cannotResolveReport": "Cannot resolve report", "desktop.agent.resizeSidebar": "Resize sidebar", "desktop.agent.toolsOn": "Tools on", "desktop.agent.toolsOffTitle": "Tools off", "desktop.agent.toolsToggle": "Tools toggle", "desktop.agent.toolsOnStatus": "Tools enabled", "desktop.agent.toolsOffStatus": "Tools disabled", "desktop.agent.callingTool": "Calling {0}", "desktop.agent.executingTool": "Executing {0}", "desktop.agent.toolTraceTitle": "Tool activity", "desktop.agent.toolTraceDescription": "Calls made while generating this answer.", "desktop.agent.toolTraceEmpty": "No tool calls were needed for this answer.", "desktop.agent.toolTraceSummary": "{0} tool calls", "desktop.agent.toolTraceLlmRound": "LLM request round {0}", "desktop.agent.toolTraceDuration": "{0} ms", "desktop.agent.toolTraceInput": "Input", "desktop.agent.toolTraceOutput": "Output", "desktop.agent.toolTraceImpact.write": "Write", "desktop.agent.toolTraceStatus.awaiting_approval": "Approval needed", "desktop.agent.toolTraceStatus.succeeded": "Completed", "desktop.agent.executionTraceTitle": "Execution flow", "desktop.agent.executionTraceDescription": "Context retrieval, model requests, and actions used to generate this answer.", "desktop.agent.executionTraceSummary": "Execution flow", "desktop.agent.executionSummary.retrieval": "{0} retrieval", "desktop.agent.executionSummary.tool": "{0} tools", "desktop.agent.executionSummary.llm": "{0} LLM", "desktop.agent.executionSummary.skill": "{0} skills", "desktop.agent.executionGroup.retrieval": "Context retrieval", "desktop.agent.executionGroup.llm": "Model reasoning", "desktop.agent.executionGroup.tool": "Actions", "desktop.agent.executionGroup.skill": "Skills", "desktop.agent.executionCapability.mcp": "MCP", "desktop.agent.executionStep.reportRetrieval": "Report retrieval", "desktop.agent.executionStep.noteRetrieval": "Note retrieval", "desktop.agent.executionStep.sessionRetrieval": "Session retrieval", "desktop.agent.toolApprovalNeeded": "Approval needed: {0}", "desktop.agent.toolApprovalPrompt": "Allow this action?", "desktop.agent.toolApprovalAllow": "Allow", "desktop.agent.toolApprovalDeny": "Deny", "desktop.agent.copied": "Copied", "desktop.agent.copiedAnswer": "Answer copied", "desktop.agent.createFailedPrefix": "Create failed: {0}", "desktop.agent.loadThreadsFailedPrefix": "Load failed: {0}", "desktop.agent.loadChatFailedPrefix": "Load failed: {0}", "desktop.agent.loadOlderFailedPrefix": "Load older failed: {0}", "desktop.agent.deleteFailedPrefix": "Delete failed: {0}", "desktop.agent.renameFailedPrefix": "Rename failed: {0}", "desktop.agent.auditLoading": "Loading trace", "desktop.common.copy": "Copy", "desktop.common.edit": "Edit", "desktop.common.resend": "Resend", "desktop.common.send": "Send", "desktop.common.cancel": "Cancel", "desktop.common.confirm": "Confirm", "desktop.common.refresh": "Refresh", "desktop.common.loading": "Loading", "desktop.common.hideSidebar": "Hide sidebar", "desktop.common.showSidebar": "Show sidebar", "desktop.tabs.agent": "Agent"
};

describe("AgentPanel", () => {
  it("opens a persisted tool trace in the right drawer", async () => {
    const host = document.createElement("div"); host.id = "react-agent"; document.body.append(host);
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages }), onLocaleChanged: () => () => undefined,
      listAgentThreads: async () => [thread], listAgentChat: async () => ({ messages: [{ id: "a-1", role: "assistant", content: "Done", createdAtMs: 1, sortOrder: 1, toolTrace: [{ id: "retrieve-1", kind: "retrieval", status: "succeeded", startedAtMs: 1, completedAtMs: 2, toolName: "report_context_search", source: { kind: "system", name: "Ask context" }, result: "{\\\"count\\\":1}" }, { id: "llm-1", kind: "llm", status: "succeeded", startedAtMs: 2, completedAtMs: 3, iteration: 1, source: { kind: "llm", name: "chat" } }, { id: "call-1", kind: "tool", status: "succeeded", startedAtMs: 3, completedAtMs: 4, toolName: "note_write", capability: "mcp", source: { kind: "mcp", name: "Built-in MCP" }, impact: "write", args: { noteId: "n-1" }, result: "saved" }] }], hasMore: false }), listOlderAgentChat: async () => ({ messages: [], hasMore: false }),
      createAgentThread: async () => thread, deleteAgentThread: async () => ({ ok: true }), renameAgentThread: async () => ({ ok: true }), askAgent: async () => ({ answer: "", citations: [], fallback: false, digests: [] }), cancelAskAgent: async () => ({ ok: true }), onAskStream: () => () => undefined, clearAgentChat: async () => ({ ok: true })
    } as unknown as typeof window.agentResume;
    render(<I18nProvider><AgentPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "agent" })));
    fireEvent.click(await screen.findByRole("button", { name: /Execution flow\s*1 retrieval\s*1 tools\s*1 LLM/ }));
    expect(screen.getByRole("dialog", { name: "Execution flow" })).toBeTruthy();
    expect(screen.getByText("Context retrieval")).toBeTruthy();
    expect(screen.getByText("Model reasoning")).toBeTruthy();
    expect(screen.getByText("Actions")).toBeTruthy();
    expect(screen.getByText("note_write")).toBeTruthy();
    fireEvent.click(screen.getByText("Input"));
    expect(screen.getByText(/noteId/)).toBeTruthy();
  });

  it("shows the tool trace entry when no tools were called", async () => {
    const host = document.createElement("div"); host.id = "react-agent"; document.body.append(host);
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages }), onLocaleChanged: () => () => undefined,
      listAgentThreads: async () => [thread], listAgentChat: async () => ({ messages: [{ id: "a-1", role: "assistant", content: "Done", createdAtMs: 1, sortOrder: 1 }], hasMore: false }), listOlderAgentChat: async () => ({ messages: [], hasMore: false }),
      createAgentThread: async () => thread, deleteAgentThread: async () => ({ ok: true }), renameAgentThread: async () => ({ ok: true }), askAgent: async () => ({ answer: "", citations: [], fallback: false, digests: [] }), cancelAskAgent: async () => ({ ok: true }), onAskStream: () => () => undefined, clearAgentChat: async () => ({ ok: true }), listAgentNoteAudit: async () => []
    } as unknown as typeof window.agentResume;
    render(<I18nProvider><AgentPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "agent" })));
    fireEvent.click(await screen.findByRole("button", { name: "Execution flow" }));
    expect(screen.getByRole("dialog", { name: "Execution flow" })).toBeTruthy();
    expect(screen.getByText("No tool calls were needed for this answer.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Trace" }));
    const auditEmpty = await screen.findByText("No trace");
    expect(auditEmpty.closest(".agent-chat-notices")).toBeTruthy();
    expect(document.querySelector(".chat-compose")?.nextElementSibling).toBeNull();
  });

  it("loads a thread and sends a streamed Agent request", async () => {
    const host = document.createElement("div"); host.id = "react-agent"; document.body.append(host);
    let stream: ((event: AgentStreamEvent) => void) | undefined;
    let resolveAsk: ((value: { answer: string; citations: []; fallback: boolean; digests: [] }) => void) | undefined;
    const askAgent = vi.fn(() => new Promise<{ answer: string; citations: []; fallback: boolean; digests: [] }>((resolve) => { resolveAsk = resolve; }));
    const listAgentChat = vi.fn()
      .mockResolvedValueOnce({ messages: [{ id: "m-1", role: "assistant", content: "Saved answer", createdAtMs: 1, sortOrder: 1 }], hasMore: false })
      .mockResolvedValueOnce({
        messages: [
          { id: "m-1", role: "assistant", content: "Saved answer", createdAtMs: 1, sortOrder: 1 },
          { id: "u-2", role: "user", content: "Summarize this", createdAtMs: 2, sortOrder: 2 },
          { id: "a-2", role: "assistant", content: "Completed response", createdAtMs: 3, sortOrder: 3 }
        ],
        hasMore: false
      });
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages }),
      onLocaleChanged: () => () => undefined,
      listAgentThreads: async () => [thread],
      listAgentChat,
      listOlderAgentChat: async () => ({ messages: [], hasMore: false }),
      askAgent,
      onAskStream: (callback: (event: AgentStreamEvent) => void) => { stream = callback; return () => undefined; },
      renameAgentThread: async () => ({ ok: true }),
      createAgentThread: async () => thread,
      deleteAgentThread: async () => ({ ok: true }),
      cancelAskAgent: async () => ({ ok: true })
    } as unknown as typeof window.agentResume;
    render(<I18nProvider><AgentPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "agent" })));
    await screen.findByText("Saved answer");
    const input = screen.getByPlaceholderText("Type a message");
    expect(document.querySelector(".chat-compose-frame")).toBeTruthy();
    expect(document.querySelector(".chat-compose-toolbar")).toBeTruthy();
    expect(document.querySelector(".chat-compose-context")?.getAttribute("title")).toBe("Renderer work");
    expect(screen.getByRole("button", { name: "Tools toggle" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Send" }).hasAttribute("disabled")).toBe(true);
    fireEvent.change(input, { target: { value: "Summarize this" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await act(async () => stream?.({ phase: "generating", message: "Requesting LLM" }));
    const activity = screen.getByText("Requesting LLM");
    expect(activity.closest(".chat-bubble")?.className).toContain("assistant");
    expect(document.querySelector(".ask-chat-shell > .status")).toBeNull();
    await act(async () => stream?.({ phase: "chunk", delta: "Partial" }));
    await screen.findByText("Partial");
    expect(screen.queryByText("Requesting LLM")).toBeNull();
    await waitFor(() => expect(askAgent).toHaveBeenCalledWith(expect.objectContaining({ query: "Summarize this", threadId: "thread-1", enableTools: true })));
    await act(async () => resolveAsk?.({ answer: "Completed response", citations: [], fallback: false, digests: [] }));
    await screen.findByText("Completed response");
    const completion = screen.getByText("Done · 0 sources");
    expect(completion.parentElement?.textContent).toContain("Memory retrieval");
  });

  it("shows pending tool approval above the input without opening the execution drawer", async () => {
    const host = document.createElement("div"); host.id = "react-agent"; document.body.append(host);
    let stream: ((event: AgentStreamEvent) => void) | undefined;
    const respondToolApproval = vi.fn(async () => ({ ok: true }));
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages }), onLocaleChanged: () => () => undefined,
      listAgentThreads: async () => [thread], listAgentChat: async () => ({ messages: [], hasMore: false }), listOlderAgentChat: async () => ({ messages: [], hasMore: false }),
      createAgentThread: async () => thread, deleteAgentThread: async () => ({ ok: true }), renameAgentThread: async () => ({ ok: true }), cancelAskAgent: async () => ({ ok: true }), clearAgentChat: async () => ({ ok: true }),
      askAgent: async () => new Promise(() => undefined),
      onAskStream: (callback: (event: AgentStreamEvent) => void) => { stream = callback; return () => undefined; },
      respondToolApproval
    } as unknown as typeof window.agentResume;
    render(<I18nProvider><AgentPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "agent" })));
    fireEvent.change(screen.getByPlaceholderText("Type a message"), { target: { value: "Write a note" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await act(async () => stream?.({ phase: "execution", execution: { id: "tool-1", kind: "tool", status: "pending", startedAtMs: 1, toolName: "note_write", capability: "mcp", impact: "write" } }));
    await act(async () => stream?.({ phase: "tool_approval_required", toolCallId: "tool-1", toolName: "note_write" }));
    expect(screen.getByRole("region", { name: "Approval needed: note_write" })).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: "Execution flow" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Allow" }));
    await waitFor(() => expect(respondToolApproval).toHaveBeenCalledWith({ toolCallId: "tool-1", approved: true }));
    expect(screen.queryByRole("region", { name: "Approval needed: note_write" })).toBeNull();
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

  it("shows indexing progress and opens report citations in the side sheet", async () => {
    const host = document.createElement("div"); host.id = "react-agent"; document.body.append(host);
    let indexProgress: ((event: { phase: string; message: string; current: number; total: number }) => void) | undefined;
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
    expect(screen.getByText("1/2").closest(".agent-chat-notices")).toBeTruthy();
    expect(document.querySelector(".agent-chat-notices")?.nextElementSibling?.classList.contains("chat-log")).toBe(true);
    await act(async () => indexProgress?.({ phase: "complete", message: "Note index is up to date", current: 2, total: 2 }));
    expect(screen.getAllByText("Note index is up to date")).toHaveLength(1);
    expect(screen.getByText("Note index is up to date").closest(".agent-chat-notices")).toBeTruthy();
    expect(document.querySelector(".chat-compose")?.nextElementSibling).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Citation 1" }));
    expect(screen.getByRole("dialog", { name: "Citations" })).toBeTruthy();
    const citation = screen.getByRole("button", { name: /\[1\] daily · Daily/ });
    fireEvent.click(citation);
    await screen.findByText("Preview body");
    expect(getReportEntry).toHaveBeenCalledWith("daily:2026-07-19");
    fireEvent.click(screen.getByRole("button", { name: /Execution flow\s*1 retrieval/ }));
    expect(screen.getByText("Report retrieval")).toBeTruthy();
  });

  it("opens inline report, note, and session citations from the answer", async () => {
    const host = document.createElement("div"); host.id = "react-agent"; document.body.append(host);
    const tabRequests: string[] = [];
    const reportFocus: unknown[] = [];
    const openedNotes: string[] = [];
    const sessionPreviews: unknown[] = [];
    const onTabRequest = (event: Event) => tabRequests.push((event as CustomEvent<string>).detail);
    const onReportFocus = (event: Event) => reportFocus.push((event as CustomEvent).detail);
    const onOpenNote = (event: Event) => openedNotes.push((event as CustomEvent<string>).detail);
    const onSessionPreview = (event: Event) => sessionPreviews.push((event as CustomEvent).detail);
    window.addEventListener("agent-resume:tab-request", onTabRequest);
    window.addEventListener("agent-resume:report-focus", onReportFocus);
    window.addEventListener("agent-resume:open-note", onOpenNote);
    window.addEventListener("agent-resume:sessions-preview", onSessionPreview);
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages }), onLocaleChanged: () => () => undefined,
      listAgentThreads: async () => [thread],
      listAgentChat: async () => ({
        messages: [{
          id: "m-inline",
          role: "assistant",
          content: "Report [1], note [N1], session [S1], and missing [N9]. `Code [N1]`\n\n```text\n[S1]\n```",
          createdAtMs: 1,
          sortOrder: 1,
          citations: [
            { index: 1, reportId: "daily:2026-07-19", level: "daily", title: "Daily" },
            { source: "note", index: 1, noteId: "note-1", level: "note", title: "Plan" },
            { source: "session", index: 1, level: "session", title: "Auth", session: { provider: "codex", id: "session-1", projectPath: "/tmp/app" } }
          ]
        }],
        hasMore: false
      }),
      listOlderAgentChat: async () => ({ messages: [], hasMore: false }),
      createAgentThread: async () => thread, deleteAgentThread: async () => ({ ok: true }), renameAgentThread: async () => ({ ok: true }), askAgent: async () => ({ answer: "", citations: [], fallback: false, digests: [] }), cancelAskAgent: async () => ({ ok: true }), onAskStream: () => () => undefined, clearAgentChat: async () => ({ ok: true })
    } as unknown as typeof window.agentResume;
    try {
      render(<I18nProvider><AgentPanel /></I18nProvider>);
      await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "agent" })));
      await screen.findByRole("link", { name: "[1]" });
      expect(document.querySelectorAll(".agent-citation-link")).toHaveLength(3);
      expect(screen.queryByRole("link", { name: "[N9]" })).toBeNull();
      expect(document.querySelector("code")?.textContent).toBe("Code [N1]");
      expect(document.querySelector("pre")?.textContent).toContain("[S1]");

      fireEvent.click(screen.getByRole("link", { name: "[1]" }));
      expect(tabRequests).toContain("report");
      expect(reportFocus[0]).toEqual({ type: "day", key: "2026-07-19" });

      fireEvent.click(screen.getByRole("link", { name: "[N1]" }));
      expect(tabRequests).toContain("notes");
      expect(openedNotes).toEqual(["note-1"]);

      fireEvent.click(screen.getByRole("link", { name: "[S1]" }));
      expect(sessionPreviews[0]).toMatchObject({ provider: "codex", id: "session-1", projectPath: "/tmp/app" });
    } finally {
      window.removeEventListener("agent-resume:tab-request", onTabRequest);
      window.removeEventListener("agent-resume:report-focus", onReportFocus);
      window.removeEventListener("agent-resume:open-note", onOpenNote);
      window.removeEventListener("agent-resume:sessions-preview", onSessionPreview);
    }
  });

  it("shows session citations separately and opens Sessions sheet", async () => {
    const host = document.createElement("div"); host.id = "react-agent"; document.body.append(host);
    const opened: unknown[] = [];
    const onPreview = (event: Event) => opened.push((event as CustomEvent).detail);
    window.addEventListener("agent-resume:sessions-preview", onPreview);
    const workbenchOpenSession = vi.fn(async () => ({ mode: "external-system", command: "codex resume sess-1", cwd: "/tmp/app", external: true }));
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages }), onLocaleChanged: () => () => undefined,
      listAgentThreads: async () => [thread],
      listAgentChat: async () => ({
        messages: [{
          id: "m-1",
          role: "assistant",
          content: "Found a session",
          createdAtMs: 1,
          sortOrder: 1,
          citations: [{
            source: "session",
            index: 1,
            level: "session",
            title: "Auth OAuth",
            contentPreview: "Implemented OAuth login",
            operation: "search",
            session: { provider: "codex", id: "sess-1", projectPath: "/tmp/app" }
          }]
        }],
        hasMore: false
      }),
      listOlderAgentChat: async () => ({ messages: [], hasMore: false }),
      createAgentThread: async () => thread, deleteAgentThread: async () => ({ ok: true }), renameAgentThread: async () => ({ ok: true }),
      askAgent: async () => ({ answer: "", citations: [], fallback: false, digests: [] }), cancelAskAgent: async () => ({ ok: true }), onAskStream: () => () => undefined, clearAgentChat: async () => ({ ok: true }),
      workbenchOpenSession
    } as unknown as typeof window.agentResume;
    try {
      render(<I18nProvider><AgentPanel /></I18nProvider>);
      await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "agent" })));
      await screen.findByText("Found a session");
      fireEvent.click(screen.getByRole("button", { name: "Citation 1" }));
      const chip = screen.getByRole("button", { name: /\[S1\].*Auth OAuth/ });
      fireEvent.click(chip);
      await screen.findByText(/Implemented OAuth login/);
      expect(screen.getByRole("button", { name: "Resume" })).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Resume" }));
      await waitFor(() => expect(workbenchOpenSession).toHaveBeenCalledWith({ provider: "codex", id: "sess-1" }));
      fireEvent.click(screen.getByRole("button", { name: "Open in Sessions" }));
      expect(opened[0]).toMatchObject({ provider: "codex", id: "sess-1", projectPath: "/tmp/app" });
    } finally {
      window.removeEventListener("agent-resume:sessions-preview", onPreview);
    }
  });

  it("completes xterm resume by switching to Workbench with command payload", async () => {
    const host = document.createElement("div"); host.id = "react-agent"; document.body.append(host);
    const tabs: string[] = [];
    const resumes: unknown[] = [];
    const onTab = (event: Event) => tabs.push((event as CustomEvent).detail);
    const onResume = (event: Event) => resumes.push((event as CustomEvent).detail);
    window.addEventListener("agent-resume:tab-request", onTab);
    window.addEventListener("agent-resume:workbench-resume", onResume);
    const workbenchOpenSession = vi.fn(async () => ({
      mode: "xterm",
      command: "codex resume --cd '/tmp/app' 'sess-xterm'",
      cwd: "/tmp/app",
      external: false
    }));
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages }), onLocaleChanged: () => () => undefined,
      listAgentThreads: async () => [thread],
      listAgentChat: async () => ({
        messages: [{
          id: "m-x",
          role: "assistant",
          content: "Resume this session",
          createdAtMs: 1,
          sortOrder: 1,
          citations: [{
            source: "session",
            index: 1,
            level: "session",
            title: "Xterm session",
            contentPreview: "work",
            session: { provider: "codex", id: "sess-xterm", projectPath: "/tmp/app" }
          }]
        }],
        hasMore: false
      }),
      listOlderAgentChat: async () => ({ messages: [], hasMore: false }),
      createAgentThread: async () => thread, deleteAgentThread: async () => ({ ok: true }), renameAgentThread: async () => ({ ok: true }),
      askAgent: async () => ({ answer: "", citations: [], fallback: false, digests: [] }), cancelAskAgent: async () => ({ ok: true }), onAskStream: () => () => undefined, clearAgentChat: async () => ({ ok: true }),
      workbenchOpenSession
    } as unknown as typeof window.agentResume;
    try {
      render(<I18nProvider><AgentPanel /></I18nProvider>);
      await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "agent" })));
      await screen.findByText("Resume this session");
      fireEvent.click(screen.getByRole("button", { name: "Citation 1" }));
      const chip = screen.getByRole("button", { name: /\[S1\].*Xterm session/ });
      fireEvent.click(chip);
      await screen.findByRole("button", { name: "Resume" });
      fireEvent.click(screen.getByRole("button", { name: "Resume" }));
      await waitFor(() => expect(workbenchOpenSession).toHaveBeenCalledWith({ provider: "codex", id: "sess-xterm" }));
      await waitFor(() => expect(tabs).toContain("workbench"));
      await waitFor(() =>
        expect(resumes[0]).toMatchObject({
          provider: "codex",
          id: "sess-xterm",
          command: "codex resume --cd '/tmp/app' 'sess-xterm'",
          cwd: "/tmp/app",
          projectPath: "/tmp/app"
        })
      );
    } finally {
      window.removeEventListener("agent-resume:tab-request", onTab);
      window.removeEventListener("agent-resume:workbench-resume", onResume);
    }
  });

  it("resends a user message after truncating later turns", async () => {
    const host = document.createElement("div"); host.id = "react-agent"; document.body.append(host);
    const truncateAgentChat = vi.fn(async () => ({ ok: true }));
    const askAgent = vi.fn(async () => ({ answer: "Regenerated", citations: [], fallback: false, digests: [] }));
    const listAgentChat = vi.fn()
      .mockResolvedValueOnce({
        messages: [
          { id: "u-1", role: "user", content: "First question", createdAtMs: 1, sortOrder: 1 },
          { id: "a-1", role: "assistant", content: "First answer", createdAtMs: 2, sortOrder: 2 },
          { id: "u-2", role: "user", content: "Second question", createdAtMs: 3, sortOrder: 3 },
          { id: "a-2", role: "assistant", content: "Second answer", createdAtMs: 4, sortOrder: 4 }
        ],
        hasMore: false
      })
      .mockResolvedValueOnce({
        messages: [
          { id: "u-1", role: "user", content: "First question", createdAtMs: 1, sortOrder: 1 },
          { id: "a-1", role: "assistant", content: "First answer", createdAtMs: 2, sortOrder: 2 },
          { id: "u-2b", role: "user", content: "Second question", createdAtMs: 5, sortOrder: 5 },
          { id: "a-2b", role: "assistant", content: "Regenerated", createdAtMs: 6, sortOrder: 6 }
        ],
        hasMore: false
      });
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages }),
      onLocaleChanged: () => () => undefined,
      listAgentThreads: async () => [thread],
      listAgentChat,
      listOlderAgentChat: async () => ({ messages: [], hasMore: false }),
      truncateAgentChat,
      askAgent,
      onAskStream: () => () => undefined,
      renameAgentThread: async () => ({ ok: true }),
      createAgentThread: async () => thread,
      deleteAgentThread: async () => ({ ok: true }),
      cancelAskAgent: async () => ({ ok: true })
    } as unknown as typeof window.agentResume;
    render(<I18nProvider><AgentPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "agent" })));
    await screen.findByText("Second question");
    fireEvent.contextMenu(screen.getByText("Second question"));
    const menu = document.querySelector(".chat-context-menu");
    expect(menu).toBeTruthy();
    expect(menu?.textContent).toContain("Copy");
    expect(menu?.textContent).toContain("Edit");
    expect(menu?.textContent).toContain("Resend");
    fireEvent.click(Array.from(menu!.querySelectorAll("button")).find((button) => button.textContent === "Resend")!);
    await waitFor(() => expect(truncateAgentChat).toHaveBeenCalledWith({ threadId: "thread-1", fromSortOrder: 3 }));
    await waitFor(() => expect(askAgent).toHaveBeenCalledWith(expect.objectContaining({
      query: "Second question",
      threadId: "thread-1",
      history: [
        { role: "user", content: "First question" },
        { role: "assistant", content: "First answer" }
      ]
    })));
    await screen.findByText("Regenerated");
    expect(screen.queryByText("Second answer")).toBeNull();
  });

  it("edits a user message then truncates and resends", async () => {
    const host = document.createElement("div"); host.id = "react-agent"; document.body.append(host);
    const truncateAgentChat = vi.fn(async () => ({ ok: true }));
    const askAgent = vi.fn(async () => ({ answer: "Edited reply", citations: [], fallback: false, digests: [] }));
    const listAgentChat = vi.fn()
      .mockResolvedValueOnce({
        messages: [
          { id: "u-1", role: "user", content: "Original question", createdAtMs: 1, sortOrder: 1 },
          { id: "a-1", role: "assistant", content: "Original answer", createdAtMs: 2, sortOrder: 2 }
        ],
        hasMore: false
      })
      .mockResolvedValueOnce({
        messages: [
          { id: "u-2", role: "user", content: "Edited question", createdAtMs: 3, sortOrder: 3 },
          { id: "a-2", role: "assistant", content: "Edited reply", createdAtMs: 4, sortOrder: 4 }
        ],
        hasMore: false
      });
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages }),
      onLocaleChanged: () => () => undefined,
      listAgentThreads: async () => [thread],
      listAgentChat,
      listOlderAgentChat: async () => ({ messages: [], hasMore: false }),
      truncateAgentChat,
      askAgent,
      onAskStream: () => () => undefined,
      renameAgentThread: async () => ({ ok: true }),
      createAgentThread: async () => thread,
      deleteAgentThread: async () => ({ ok: true }),
      cancelAskAgent: async () => ({ ok: true })
    } as unknown as typeof window.agentResume;
    render(<I18nProvider><AgentPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "agent" })));
    await screen.findByText("Original question");
    fireEvent.contextMenu(screen.getByText("Original question"));
    const menu = document.querySelector(".chat-context-menu");
    fireEvent.click(Array.from(menu!.querySelectorAll("button")).find((button) => button.textContent === "Edit")!);
    const editor = screen.getByLabelText("Edit") as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: "Edited question" } });
    const editActions = document.querySelector(".chat-bubble-edit-actions");
    fireEvent.click(Array.from(editActions!.querySelectorAll("button")).find((button) => button.textContent === "Send")!);
    await waitFor(() => expect(truncateAgentChat).toHaveBeenCalledWith({ threadId: "thread-1", fromSortOrder: 1 }));
    await waitFor(() => expect(askAgent).toHaveBeenCalledWith(expect.objectContaining({
      query: "Edited question",
      history: []
    })));
    await screen.findByText("Edited reply");
  });
});
