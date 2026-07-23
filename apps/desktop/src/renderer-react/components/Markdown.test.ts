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
});
