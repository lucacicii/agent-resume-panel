import { describe, expect, it } from "vitest";
import type { ImMember, ImMessage } from "../../../shared/imTypes";
import { buildTimelineNodes, cleanSnippet } from "./timelineModel";

describe("timelineModel", () => {
  it("cleans markdown and trims snippets", () => {
    expect(cleanSnippet("Hello **world** with `code` and [link](https://example.com)")).toBe(
      "Hello world with code and link"
    );
    expect(cleanSnippet("```ts\nconst a = 1;\n```\nHere is the code")).toBe("[code] Here is the code");
    expect(cleanSnippet("A".repeat(80), 30).length).toBe(30);
  });

  it("builds timeline nodes from messages and members", () => {
    const member: ImMember = {
      memberId: "m1",
      projectId: "p1",
      templateId: "role_developer",
      name: "Developer",
      persona: "",
      agent: "claude",
      permissions: "write",
      tools: { fsRead: true, fsWrite: true, execute: true },
      enabled: true,
      acpChatId: null,
      createdAtMs: 1000,
      updatedAtMs: 1000
    };

    const messages: ImMessage[] = [
      {
        messageId: "msg-1",
        projectId: "p1",
        kind: "human",
        authorMemberId: null,
        authorLabel: "You",
        body: "Please review PR #12",
        quoteIds: [],
        quotes: [],
        mentionRoleIds: ["m1"],
        jobId: null,
        createdAtMs: 1000
      },
      {
        messageId: "msg-2",
        projectId: "p1",
        kind: "role.say",
        authorMemberId: "m1",
        authorLabel: "Developer",
        body: "Code looks good to merge.",
        quoteIds: [],
        quotes: [],
        mentionRoleIds: [],
        jobId: "j1",
        createdAtMs: 2000
      },
      {
        messageId: "msg-3",
        projectId: "p1",
        kind: "system",
        authorMemberId: null,
        authorLabel: "System",
        body: "System alert",
        quoteIds: [],
        quotes: [],
        mentionRoleIds: [],
        jobId: null,
        createdAtMs: 3000
      }
    ];

    const nodes = buildTimelineNodes(
      messages,
      [member],
      () => "#10b981",
      (m) => m.name,
      (label) => label.slice(0, 1).toUpperCase(),
      () => "10:00",
      () => "Today"
    );

    expect(nodes).toHaveLength(2); // skips system messages
    expect(nodes[0]?.authorLabel).toBe("You");
    expect(nodes[0]?.isUser).toBe(true);
    expect(nodes[1]?.authorLabel).toBe("Developer");
    expect(nodes[1]?.roleColor).toBe("#10b981");
    expect(nodes[1]?.authorInitial).toBe("D");
  });
});
