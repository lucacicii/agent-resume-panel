import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { GtdSheet } from "./GtdSheet";

afterEach(() => {
  cleanup();
});

describe("GtdSheet", () => {
  it("previews and applies a scoped GTD proposal through the desktop bridge", async () => {
    const previewReportGtdSync = vi.fn(async () => ({
      previewId: "preview-1",
      proposals: [{ provider: "codex", sessionId: "session-1", title: "Fix migration", projectPath: "/work/app", previousGtd: "inbox", proposedGtd: "next", reason: "Renderer work", tasks: ["Verify panel"], sourceReportIds: ["daily:2026-01-01"], todolistPreview: "# Work" }],
      skipped: [], warnings: []
    }));
    const applyReportGtdSync = vi.fn(async () => ({ applied: [{ provider: "codex", sessionId: "session-1", previousStatus: "inbox", newStatus: "next" }], failed: [], jobKey: "job-1" }));
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages: {
        "desktop.sheet.gtdTitle": "Digest to GTD", "desktop.sheet.gtdDesc": "Selected digest preview.", "desktop.report.gtdReanalyze": "Analyze again", "desktop.report.gtdAnalyzing": "Analyzing {0}", "desktop.report.gtdPreviewStatus": "{0} proposals", "desktop.report.gtdNotSaved": "not saved", "desktop.report.gtdAddingItem": "Adding {0}", "desktop.report.gtdAddFailed": "Could not add", "desktop.report.gtdApplied": "Applied {0}", "desktop.report.gtdAllApplied": "All applied", "desktop.report.gtdNoProposals": "No proposals", "desktop.report.gtdNoSessionsReason": "No sessions", "desktop.report.gtdWarnDefault": "No matching sessions", "desktop.report.gtdWasNone": "None", "desktop.report.gtdCollapseTitle": "Collapse", "desktop.report.gtdWasLabel": "Was {0}", "desktop.report.gtdAdding": "Adding", "desktop.report.gtdAddBtn": "Add GTD", "desktop.report.gtdStatusLabel": "Status", "desktop.report.gtdReasonLabel": "Reason", "desktop.report.gtdTasksLabel": "Tasks", "desktop.report.gtdTodoLabel": "Todo", "desktop.report.gtdFocusEditor": "Open editor", "desktop.report.gtdMdDialog": "Edit todolist", "desktop.report.gtdMdHint": "Press Escape", "desktop.report.gtdMdDone": "Done", "desktop.common.close": "Close"
      } }),
      onLocaleChanged: () => () => undefined,
      previewReportGtdSync,
      applyReportGtdSync
    } as unknown as typeof window.agentResume;
    render(<I18nProvider><GtdSheet /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:gtd-open", { detail: { level: "daily", reportId: "daily:2026-01-01" } })));
    await screen.findByText("Fix migration");
    expect(screen.getByRole("dialog", { name: "Digest to GTD" })).toBeTruthy();
    expect(screen.getByText("Selected digest preview.")).toBeTruthy();
    fireEvent.change(screen.getByDisplayValue("Renderer work"), { target: { value: "Updated reason" } });
    fireEvent.click(screen.getByRole("button", { name: "Add GTD" }));
    await waitFor(() => expect(applyReportGtdSync).toHaveBeenCalledWith(expect.objectContaining({ items: [expect.objectContaining({ reason: "Updated reason", gtd: "next" })] })));
    expect(previewReportGtdSync).toHaveBeenCalledWith({ ensureDigests: false, reportIds: ["daily:2026-01-01"] });
  });

  it("keeps draft edits per digest and opens the large todolist editor", async () => {
    const previewReportGtdSync = vi.fn(async ({ reportIds }: { reportIds: string[] }) => ({
      previewId: "preview-1", proposals: [{ provider: "codex", sessionId: reportIds[0], title: reportIds[0], projectPath: "/work/app", previousGtd: null, proposedGtd: "next", reason: "Original", tasks: [], sourceReportIds: reportIds, todolistPreview: "# Todo" }], skipped: [], warnings: []
    }));
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages: {} }), onLocaleChanged: () => () => undefined, previewReportGtdSync, applyReportGtdSync: vi.fn()
    } as unknown as typeof window.agentResume;
    render(<I18nProvider><GtdSheet /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:gtd-open", { detail: { level: "daily", reportId: "daily:2026-01-01" } })));
    await screen.findByDisplayValue("Original");
    fireEvent.change(screen.getByDisplayValue("Original"), { target: { value: "Edited" } });
    fireEvent.focus(screen.getByDisplayValue("# Todo"));
    const editor = document.querySelector<HTMLTextAreaElement>(".gtd-md-overlay-ta");
    expect(editor).toBeTruthy();
    fireEvent.change(editor!, { target: { value: "# Updated" } });
    fireEvent.click(screen.getByRole("button", { name: "desktop.report.gtdMdDone" }));
    await screen.findByDisplayValue("# Updated");
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:gtd-open", { detail: { level: "weekly", reportId: "weekly:2026-W01" } })));
    await screen.findByText("weekly:2026-W01");
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:gtd-open", { detail: { level: "daily", reportId: "daily:2026-01-01" } })));
    await screen.findByDisplayValue("Edited");
    expect(screen.getByDisplayValue("# Updated")).toBeTruthy();
    expect(previewReportGtdSync).toHaveBeenCalledTimes(2);
  });
});
