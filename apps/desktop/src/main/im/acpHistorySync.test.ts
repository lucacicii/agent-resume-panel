import { describe, expect, it } from "vitest";
import type { AcpChatMessage } from "../acp/types";
import { isTruncatedPrefix, planAcpHistorySync } from "./acpHistorySync";
import type { ImMessage } from "./types";

function acpAssistant(overrides: Partial<AcpChatMessage> & { id: string }): AcpChatMessage {
  return {
    role: "assistant",
    text: "",
    timestamp: 1000,
    ...overrides
  };
}

function imSay(overrides: Partial<ImMessage> & { messageId: string }): ImMessage {
  return {
    projectId: "proj-1",
    kind: "role.say",
    authorMemberId: "mem-1",
    authorLabel: "PM",
    body: "",
    quoteIds: [],
    quotes: [],
    mentionRoleIds: [],
    jobId: null,
    createdAtMs: 500,
    ...overrides
  };
}

const member = { memberId: "mem-1", name: "PM", projectId: "proj-1" };

describe("planAcpHistorySync", () => {
  it("skips user messages and already imported assistant turns", () => {
    const plans = planAcpHistorySync({
      member,
      acpMessages: [
        { id: "u1", role: "user", text: "hello", timestamp: 1 },
        acpAssistant({ id: "a1", text: "already in IM", timestamp: 2 })
      ],
      imMessages: [
        imSay({ messageId: "m1", body: "already in IM", acpMessageId: "a1", createdAtMs: 2 })
      ]
    });
    expect(plans).toEqual([]);
  });

  it("patches a truncated IM draft from a longer ACP assistant turn", () => {
    const plans = planAcpHistorySync({
      member,
      acpMessages: [
        acpAssistant({
          id: "a2",
          text: "Step 1 is done. Step 2 follows.",
          thinking: "plan",
          timestamp: 20,
          toolCalls: [{ toolCallId: "t1", title: "Read", kind: "read", status: "completed" }]
        })
      ],
      imMessages: [
        imSay({ messageId: "draft", body: "Step 1 is done.", createdAtMs: 10 })
      ]
    });
    expect(plans).toEqual([
      {
        type: "update",
        messageId: "draft",
        acpMessageId: "a2",
        body: "Step 1 is done. Step 2 follows.",
        thinking: "plan",
        toolCalls: [{ toolCallId: "t1", title: "Read", kind: "read", status: "completed" }]
      }
    ]);
  });

  it("inserts missing assistant turns with thinking and tool calls", () => {
    const plans = planAcpHistorySync({
      member,
      acpMessages: [
        acpAssistant({ id: "a1", text: "first", timestamp: 1 }),
        acpAssistant({
          id: "a2",
          text: "second",
          thinking: "hmm",
          timestamp: 2,
          toolCalls: [{ toolCallId: "t2", title: "Edit", kind: "edit", status: "completed" }]
        })
      ],
      imMessages: [
        imSay({ messageId: "m1", body: "first", acpMessageId: "a1", createdAtMs: 1 })
      ]
    });
    expect(plans).toEqual([
      {
        type: "insert",
        acpMessageId: "a2",
        body: "second",
        thinking: "hmm",
        toolCalls: [{ toolCallId: "t2", title: "Edit", kind: "edit", status: "completed" }],
        createdAtMs: 2
      }
    ]);
  });

  it("attaches acpMessageId to an exact IM match instead of inserting a duplicate", () => {
    const plans = planAcpHistorySync({
      member,
      acpMessages: [acpAssistant({ id: "a1", text: "same body", thinking: "later", timestamp: 2 })],
      imMessages: [imSay({ messageId: "m1", body: "same body", createdAtMs: 1 })]
    });
    expect(plans).toEqual([
      {
        type: "update",
        messageId: "m1",
        acpMessageId: "a1",
        body: "same body",
        thinking: "later",
        toolCalls: undefined
      }
    ]);
  });

  it("is idempotent when every ACP assistant already has acpMessageId", () => {
    const acpMessages = [
      acpAssistant({ id: "a1", text: "one", timestamp: 1 }),
      acpAssistant({ id: "a2", text: "two", timestamp: 2 })
    ];
    const imMessages = [
      imSay({ messageId: "m1", body: "one", acpMessageId: "a1", createdAtMs: 1 }),
      imSay({ messageId: "m2", body: "two", acpMessageId: "a2", createdAtMs: 2 })
    ];
    expect(planAcpHistorySync({ member, acpMessages, imMessages })).toEqual([]);
    expect(planAcpHistorySync({ member, acpMessages, imMessages })).toEqual([]);
  });
});

describe("isTruncatedPrefix", () => {
  it("detects a cut-off IM body", () => {
    expect(isTruncatedPrefix("Hello wor", "Hello world")).toBe(true);
    expect(isTruncatedPrefix("Hello world", "Hello world")).toBe(false);
    expect(isTruncatedPrefix("Other", "Hello world")).toBe(false);
  });
});
