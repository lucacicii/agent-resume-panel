import { describe, expect, it } from "vitest";
import type { ImJob, ImMessage } from "../../../shared/imTypes";
import { computeTranscriptGraph } from "./imTranscriptGraphModel";

describe("imTranscriptGraphModel", () => {
  it("returns empty map when messages list is empty", () => {
    const map = computeTranscriptGraph([]);
    expect(map.size).toBe(0);
  });

  it("computes single-level direct invocation graph (Human -> Developer)", () => {
    const messages: ImMessage[] = [
      {
        messageId: "msg-1",
        projectId: "p1",
        kind: "human",
        authorMemberId: null,
        authorLabel: "You",
        body: "@Developer build login",
        quoteIds: [],
        quotes: [],
        mentionRoleIds: ["m-dev"],
        jobId: "job-1",
        createdAtMs: 1000
      },
      {
        messageId: "msg-2",
        projectId: "p1",
        kind: "role.say",
        authorMemberId: "m-dev",
        authorLabel: "Developer",
        body: "Login is built.",
        quoteIds: [],
        quotes: [],
        mentionRoleIds: [],
        jobId: "job-1",
        createdAtMs: 2000
      }
    ];

    const jobs: ImJob[] = [
      {
        jobId: "job-1",
        projectId: "p1",
        memberId: "m-dev",
        messageId: "msg-1",
        acpChatId: "chat-1",
        status: "completed",
        brief: { persona: "", instruction: "build login", cwd: "/tmp", quotes: [], knowledge: [] },
        error: null,
        filesChanged: ["src/auth.ts"],
        permission: null,
        createdAtMs: 1000,
        updatedAtMs: 2000,
        finishedAtMs: 2000
      }
    ];

    const map = computeTranscriptGraph(messages, jobs);
    expect(map.size).toBe(2);

    const rootMeta = map.get("msg-1");
    expect(rootMeta).toBeDefined();
    expect(rootMeta?.depth).toBe(0);
    expect(rootMeta?.triggerKind).toBe("root_prompt");
    expect(rootMeta?.hasOutgoingBranches).toBe(true);

    const devMeta = map.get("msg-2");
    expect(devMeta).toBeDefined();
    expect(devMeta?.depth).toBe(1);
    expect(devMeta?.parentMessageId).toBe("msg-1");
    expect(devMeta?.triggerKind).toBe("mention");
    expect(devMeta?.hasOutgoingBranches).toBe(false);
  });

  it("computes multi-tier delegation graph (Human -> Architect -> Developer -> Tester)", () => {
    const messages: ImMessage[] = [
      {
        messageId: "msg-root",
        projectId: "p1",
        kind: "human",
        authorMemberId: null,
        authorLabel: "You",
        body: "Design and implement auth module",
        autoRouted: true,
        routedRoleName: "Architect",
        quoteIds: [],
        quotes: [],
        mentionRoleIds: ["m-arch"],
        jobId: "job-arch",
        createdAtMs: 1000
      },
      {
        messageId: "msg-arch",
        projectId: "p1",
        kind: "role.say",
        authorMemberId: "m-arch",
        authorLabel: "Architect",
        body: "Auth architecture is planned.",
        delegationProposals: [
          {
            id: "prop-dev",
            targetTemplateId: "role_developer",
            targetRoleName: "Developer",
            instruction: "Write auth handler",
            status: "auto_dispatched",
            dispatchedJobId: "job-dev",
            createdAtMs: 2000
          }
        ],
        quoteIds: [],
        quotes: [],
        mentionRoleIds: [],
        jobId: "job-arch",
        createdAtMs: 2000
      },
      {
        messageId: "msg-dev",
        projectId: "p1",
        kind: "role.say",
        authorMemberId: "m-dev",
        authorLabel: "Developer",
        body: "Auth handler done.",
        delegationProposals: [
          {
            id: "prop-test",
            targetTemplateId: "role_tester",
            targetRoleName: "Tester",
            instruction: "Verify edge cases",
            status: "auto_dispatched",
            dispatchedJobId: "job-test",
            createdAtMs: 3000
          }
        ],
        quoteIds: [],
        quotes: [],
        mentionRoleIds: [],
        jobId: "job-dev",
        createdAtMs: 3000
      },
      {
        messageId: "msg-test",
        projectId: "p1",
        kind: "role.say",
        authorMemberId: "m-test",
        authorLabel: "Tester",
        body: "Tests passed.",
        quoteIds: [],
        quotes: [],
        mentionRoleIds: [],
        jobId: "job-test",
        createdAtMs: 4000
      }
    ];

    const jobs: ImJob[] = [
      {
        jobId: "job-arch",
        projectId: "p1",
        memberId: "m-arch",
        messageId: "msg-root",
        acpChatId: "c1",
        status: "completed",
        brief: { persona: "", instruction: "", cwd: "/tmp", quotes: [], knowledge: [] },
        error: null,
        filesChanged: [],
        permission: null,
        createdAtMs: 1000,
        updatedAtMs: 2000,
        finishedAtMs: 2000
      },
      {
        jobId: "job-dev",
        projectId: "p1",
        memberId: "m-dev",
        messageId: null,
        acpChatId: "c2",
        status: "completed",
        brief: { persona: "", instruction: "", cwd: "/tmp", quotes: [], knowledge: [] },
        error: null,
        filesChanged: ["src/auth.ts"],
        permission: null,
        createdAtMs: 2000,
        updatedAtMs: 3000,
        finishedAtMs: 3000
      },
      {
        jobId: "job-test",
        projectId: "p1",
        memberId: "m-test",
        messageId: null,
        acpChatId: "c3",
        status: "completed",
        brief: { persona: "", instruction: "", cwd: "/tmp", quotes: [], knowledge: [] },
        error: null,
        filesChanged: ["src/auth.test.ts"],
        permission: null,
        createdAtMs: 3000,
        updatedAtMs: 4000,
        finishedAtMs: 4000
      }
    ];

    const map = computeTranscriptGraph(messages, jobs);

    expect(map.get("msg-root")?.depth).toBe(0);
    expect(map.get("msg-root")?.triggerKind).toBe("root_prompt");

    expect(map.get("msg-arch")?.depth).toBe(1);
    expect(map.get("msg-arch")?.parentMessageId).toBe("msg-root");
    expect(map.get("msg-arch")?.triggerKind).toBe("auto_routed");

    expect(map.get("msg-dev")?.depth).toBe(2);
    expect(map.get("msg-dev")?.parentMessageId).toBe("msg-arch");
    expect(map.get("msg-dev")?.triggerKind).toBe("auto_dispatched");

    expect(map.get("msg-test")?.depth).toBe(3);
    expect(map.get("msg-test")?.parentMessageId).toBe("msg-dev");
    expect(map.get("msg-test")?.triggerKind).toBe("auto_dispatched");
  });
});
