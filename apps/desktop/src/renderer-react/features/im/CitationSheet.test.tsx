import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentCitation } from "@agent-resume/core";
import { CitationSheet, extractCitationsFromMessage } from "./CitationSheet";
import type { ImMessage } from "../../../shared/imTypes";

const t = (key: string, fallback?: string | number, ...args: Array<string | number>) => {
  if (typeof fallback === "string") return fallback;
  return key;
};

describe("extractCitationsFromMessage", () => {
  it("extracts citation markers from message body", () => {
    const message = {
      messageId: "msg-1",
      body: "Based on your daily report [D1] and project note [N2], we fixed session [S3].",
      kind: "role.say",
      authorLabel: "Memory Specialist",
      createdAtMs: Date.now()
    } as ImMessage;

    const citations = extractCitationsFromMessage(message);
    expect(citations).toHaveLength(3);
    expect(citations[0]).toMatchObject({ index: 1, source: "report", level: "daily" });
    expect(citations[1]).toMatchObject({ index: 2, source: "note", level: "note" });
    expect(citations[2]).toMatchObject({ index: 3, source: "session", level: "session" });
  });

  it("returns empty array when message has no citations", () => {
    const message = {
      messageId: "msg-2",
      body: "No citations here.",
      kind: "human",
      authorLabel: "User",
      createdAtMs: Date.now()
    } as ImMessage;

    expect(extractCitationsFromMessage(message)).toEqual([]);
  });
});

describe("CitationSheet", () => {
  afterEach(() => {
    cleanup();
  });

  window.agentResume = {
    getReportEntry: vi.fn(async () => ({
      title: "Daily Summary 2026-09-01",
      content: "Full daily report content body."
    }))
  } as unknown as typeof window.agentResume;

  const mockCitations: AgentCitation[] = [
    {
      index: 1,
      source: "report",
      level: "daily",
      reportId: "daily:2026-09-01",
      title: "Daily Summary 2026-09-01",
      contentPreview: "Worked on auth middleware and refactoring."
    },
    {
      index: 1,
      source: "note",
      level: "note",
      noteId: "note-123",
      title: "Architecture Design",
      relMdPath: "projects/demo/architecture.md",
      contentPreview: "System architecture breakdown."
    },
    {
      index: 1,
      source: "session",
      level: "session",
      title: "Fix auth token expiration",
      session: {
        provider: "claude",
        id: "sess-abc-456",
        projectPath: "/Users/demo/project"
      }
    }
  ];

  it("renders grouped citations when open", () => {
    render(
      <CitationSheet
        open={true}
        citations={mockCitations}
        onClose={vi.fn()}
        onOpenCitation={vi.fn()}
        onResumeSession={vi.fn()}
        t={t}
      />
    );

    expect(screen.getByRole("dialog", { name: "Citations" })).toBeTruthy();
    expect(screen.getAllByText(/Daily Summary 2026-09-01/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/Architecture Design/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/Fix auth token expiration/i).length).toBeGreaterThanOrEqual(1);
  });

  it("auto-expands and triggers onOpenCitation when action button clicked", async () => {
    const onOpenCitation = vi.fn();
    const onResumeSession = vi.fn();

    render(
      <CitationSheet
        open={true}
        citations={mockCitations}
        initialMarker="N1"
        onClose={vi.fn()}
        onOpenCitation={onOpenCitation}
        onResumeSession={onResumeSession}
        t={t}
      />
    );

    const openNoteBtn = await screen.findByRole("button", { name: "Open in Notes" });
    fireEvent.click(openNoteBtn);
    expect(onOpenCitation).toHaveBeenCalledWith(
      expect.objectContaining({ noteId: "note-123", title: "Architecture Design" })
    );
  });

  it("triggers onResumeSession when resume button clicked for session citation", async () => {
    const onOpenCitation = vi.fn();
    const onResumeSession = vi.fn();

    render(
      <CitationSheet
        open={true}
        citations={mockCitations}
        initialMarker="S1"
        onClose={vi.fn()}
        onOpenCitation={onOpenCitation}
        onResumeSession={onResumeSession}
        t={t}
      />
    );

    const resumeBtn = await screen.findByRole("button", { name: "Resume in Workbench" });
    fireEvent.click(resumeBtn);
    expect(onResumeSession).toHaveBeenCalledWith(
      expect.objectContaining({
        session: expect.objectContaining({ provider: "claude", id: "sess-abc-456" })
      })
    );
  });
});
