import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { TodayPanel } from "./TodayPanel";

type WorkItem = {
  noteId: string;
  scope: string;
  filename: string;
  relDir: string;
  relMdPath: string;
  title: string;
  createdAtMs: number;
  updatedAtMs: number;
  gtdStatus?: "inbox" | "next" | "waiting" | "someday" | "reference" | "done";
  work: { next?: string; decision?: string; sessions?: string[]; projects?: string[]; primaryProject?: string };
};

const MESSAGES = {
  "desktop.tabs.today": "Today",
  "desktop.today.needsYou": "Needs you",
  "desktop.today.blocked": "Blocked",
  "desktop.today.next": "Next",
  "desktop.today.inbox": "Inbox",
  "desktop.today.nextLabel": "Next:",
  "desktop.today.noNext": "No next action",
  "desktop.today.claim": "Mark as next",
  "desktop.today.done": "Done",
  "desktop.today.someday": "Someday",
  "desktop.today.empty": "Nothing needs you right now",
  "desktop.today.more": "{0} more",
  "desktop.workbench.sessionDots": "Active sessions",
  "desktop.workbench.sessionDot.awaiting": "Waiting for you",
  "desktop.workbench.sessionDot.running": "Running",
  "desktop.workbench.sessionDot.connecting": "Connecting",
  "desktop.workbench.sessionDot.error": "Error"
};

const ITEMS: WorkItem[] = [
  { noteId: "wi-live", scope: "library", filename: "live.md", relDir: "library", relMdPath: "notes/library/live.md", title: "Board status", createdAtMs: 1, updatedAtMs: 5, gtdStatus: "next", work: { sessions: ["codex:s1"], projects: ["/work/app"] } },
  { noteId: "wi-blocked", scope: "library", filename: "blocked.md", relDir: "library", relMdPath: "notes/library/blocked.md", title: "Payments", createdAtMs: 1, updatedAtMs: 4, gtdStatus: "waiting", work: { decision: "Need provider creds" } },
  { noteId: "wi-next", scope: "library", filename: "next.md", relDir: "library", relMdPath: "notes/library/next.md", title: "Weekly review", createdAtMs: 1, updatedAtMs: 3, gtdStatus: "next", work: { next: "Draft checklist" } },
  { noteId: "wi-inbox", scope: "library", filename: "inbox.md", relDir: "library", relMdPath: "notes/library/inbox.md", title: "Loose idea", createdAtMs: 1, updatedAtMs: 2, gtdStatus: "inbox", work: {} }
];

function renderToday() {
  const notesSetGtdStatus = vi.fn(async ({ noteId, status }: { noteId: string; status: string | null }) => ({ noteId, gtdStatus: status ?? undefined }));
  window.agentResume = {
    getI18nBundle: async () => ({ locale: "en", messages: MESSAGES }),
    onLocaleChanged: () => () => undefined,
    notesListWorkItems: async () => ITEMS,
    notesSetGtdStatus
  } as unknown as typeof window.agentResume;
  render(<I18nProvider><TodayPanel /></I18nProvider>);
  return { notesSetGtdStatus };
}

function activate() {
  act(() => { window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "today" })); });
}

describe("TodayPanel", () => {
  beforeEach(() => {
    const host = document.createElement("div");
    host.id = "react-today";
    document.body.appendChild(host);
  });
  afterEach(() => {
    cleanup();
    document.querySelectorAll("#react-today").forEach((node) => node.remove());
  });

  it("sorts work items into needs-you / blocked / next / inbox", async () => {
    renderToday();
    activate();
    await screen.findByText("Board status");

    act(() => {
      window.dispatchEvent(new CustomEvent("agent-resume:active-sessions", {
        detail: [{ paneKey: "terminal:1", projectPath: "/work/app", title: "Board status", sessionKey: "codex:s1", status: "awaiting_user" }]
      }));
    });

    await waitFor(() => expect(document.querySelector(".today-section.is-needs_you")?.textContent).toContain("Board status"));
    expect(document.querySelector(".today-section.is-blocked")?.textContent).toContain("Payments");
    expect(document.querySelector(".today-section.is-next")?.textContent).toContain("Weekly review");
    expect(document.querySelector(".today-section.is-inbox")?.textContent).toContain("Loose idea");
    expect(screen.getByText("Waiting for you")).toBeTruthy();
  });

  it("opens the work item workspace from a row", async () => {
    const opened: unknown[] = [];
    const onOpen = (event: Event) => opened.push((event as CustomEvent).detail);
    window.addEventListener("agent-resume:workbench-work-item", onOpen);
    try {
      renderToday();
      activate();
      fireEvent.click(await screen.findByText("Board status"));
      await waitFor(() => expect(opened[0]).toMatchObject({
        noteId: "wi-live",
        title: "Board status",
        status: "next",
        sessions: ["codex:s1"],
        projects: ["/work/app"]
      }));
    } finally {
      window.removeEventListener("agent-resume:workbench-work-item", onOpen);
    }
  });

  it("triages a row without opening it", async () => {
    const { notesSetGtdStatus } = renderToday();
    activate();
    const row = (await screen.findByText("Loose idea")).closest(".today-row") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "Mark as next" }));
    await waitFor(() => expect(notesSetGtdStatus).toHaveBeenCalledWith({ noteId: "wi-inbox", status: "next" }));
  });
});
