import { describe, expect, it } from "vitest";
import { renderMarkdown } from "./Markdown";

describe("renderMarkdown", () => {
  it("renders legacy :::gtd blocks as ordinary Markdown without a task card", () => {
    const html = renderMarkdown(":::gtd waiting\nWait for the design review\n:::");
    expect(html).not.toContain("note-gtd-card");
    expect(html).not.toContain("gtd-status-tag");
    expect(html).toContain("Wait for the design review");
  });

  it("does not execute invalid GTD directives", () => {
    const html = renderMarkdown(":::gtd later\nNot a task\n:::");
    expect(html).not.toContain("note-gtd-card");
    expect(html).not.toContain("gtd-status-tag");
  });

  it("leaves legacy executable directives as inert Markdown", () => {
    const md = [
      ":::note-child idle note=abc",
      "Child task",
      ":::",
      "",
      ":::session codex planned",
      "Session prompt",
      ":::",
      "",
      ":::run awaiting_approval",
      "Go",
      ":::"
    ].join("\n");
    const html = renderMarkdown(md);
    expect(html).not.toContain("note-exec-card");
    expect(html).not.toContain("note-child-card");
    expect(html).toContain(":::note-child idle note=abc");
    expect(html).toContain("Child task");
    expect(html).toContain(":::session codex planned");
    expect(html).toContain(":::run awaiting_approval");
  });
});
