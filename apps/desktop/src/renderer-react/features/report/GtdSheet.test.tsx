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
        "desktop.report.gtdTitle": "GTD", "desktop.report.gtdReanalyze": "Analyze again", "desktop.report.gtdAnalyzing": "Analyzing {0}", "desktop.report.gtdPreviewStatus": "{0} proposals", "desktop.report.gtdNotSaved": "not saved", "desktop.report.gtdAddingItem": "Adding {0}", "desktop.report.gtdAddFailed": "Could not add", "desktop.report.gtdApplied": "Applied {0}", "desktop.report.gtdNoProposals": "No proposals", "desktop.report.gtdNoSessionsReason": "No sessions", "desktop.report.gtdWasNone": "None", "desktop.report.gtdCollapseTitle": "Collapse", "desktop.report.gtdWasLabel": "Was {0}", "desktop.report.gtdAdding": "Adding", "desktop.report.gtdAddBtn": "Add GTD", "desktop.report.gtdStatusLabel": "Status", "desktop.report.gtdReasonLabel": "Reason", "desktop.report.gtdTasksLabel": "Tasks", "desktop.report.gtdTodoLabel": "Todo", "desktop.common.close": "Close"
      } }),
      onLocaleChanged: () => () => undefined,
      previewReportGtdSync,
      applyReportGtdSync
    } as unknown as typeof window.agentResume;
    render(<I18nProvider><GtdSheet /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:gtd-open", { detail: { level: "daily", reportId: "daily:2026-01-01" } })));
    await screen.findByText("Fix migration");
    fireEvent.change(screen.getByDisplayValue("Renderer work"), { target: { value: "Updated reason" } });
    fireEvent.click(screen.getByRole("button", { name: "Add GTD" }));
    await waitFor(() => expect(applyReportGtdSync).toHaveBeenCalledWith(expect.objectContaining({ items: [expect.objectContaining({ reason: "Updated reason", gtd: "next" })] })));
    expect(previewReportGtdSync).toHaveBeenCalledWith({ ensureDigests: false, reportIds: ["daily:2026-01-01"] });
  });
});
