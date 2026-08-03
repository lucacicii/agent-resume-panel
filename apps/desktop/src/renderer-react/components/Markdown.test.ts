import { describe, expect, it } from "vitest";
import { renderMarkdown } from "./Markdown";

describe("renderMarkdown", () => {
  it("renders a :::gtd block as a tagged task card", () => {
    const html = renderMarkdown(":::gtd waiting\nWait for the design review\n:::");
    expect(html).toContain("note-gtd-card");
    expect(html).toContain("gtd-status-tag is-waiting");
    expect(html).toContain("@GTD/waiting");
    expect(html).toContain("Wait for the design review");
    expect(html).not.toContain(":::gtd");
  });

  it("leaves invalid GTD block syntax as ordinary Markdown", () => {
    const html = renderMarkdown(":::gtd later\nNot a task\n:::");
    expect(html).not.toContain("note-gtd-card");
    expect(html).toContain(":::gtd later");
  });

  it("renders executable note-child / session / run cards", () => {
    const md = [
      ":::note-child idle note=abc",
      "Child task",
      ":::",
      "",
      ":::session codex planned",
      ":::",
      "",
      ":::run awaiting_approval",
      "Go",
      ":::"
    ].join("\n");
    const html = renderMarkdown(md);
    expect(html).toContain("note-child-card");
    expect(html).toContain("@child/idle");
    expect(html).toContain("note-session-card");
    expect(html).toContain("@session/codex/planned");
    expect(html).toContain("note-run-card");
    expect(html).toContain("@run/awaiting_approval");
    expect(html).not.toContain(":::note-child");
  });
});
