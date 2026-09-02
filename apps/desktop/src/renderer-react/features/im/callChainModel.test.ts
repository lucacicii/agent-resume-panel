import { describe, expect, it } from "vitest";
import type { ImJob, ImMember, ImMessage } from "../../../shared/imTypes";
import { buildCallChains } from "./callChainModel";

describe("callChainModel", () => {
  const formatters = {
    roleColor: (tpl: string) => (tpl.includes("architect") ? "#1e90ff" : "#32cd32"),
    memberLabel: (m: ImMember) => m.name,
    roleInitial: (l: string) => l.charAt(0).toUpperCase(),
    formatTime: () => "12:00",
    formatDay: () => "Today"
  };

  const members: ImMember[] = [
    {
      memberId: "m-arch",
      projectId: "p1",
      templateId: "role_architect",
      name: "Architect",
      persona: "Arch persona",
      agent: "claude",
      permissions: "read",
      tools: { fsRead: true, fsWrite: false, execute: false },
      enabled: true,
      acpChatId: null,
      createdAtMs: 1000,
      updatedAtMs: 1000
    },
    {
      memberId: "m-dev",
      projectId: "p1",
      templateId: "role_developer",
      name: "Developer",
      persona: "Dev persona",
      agent: "claude",
      permissions: "write",
      tools: { fsRead: true, fsWrite: true, execute: true },
      enabled: true,
      acpChatId: null,
      createdAtMs: 1000,
      updatedAtMs: 1000
    }
  ];

  it("returns empty summary when there are no messages", () => {
    const summary = buildCallChains([], [], members, formatters);
    expect(summary.totalChains).toBe(0);
    expect(summary.totalNodes).toBe(0);
    expect(summary.chains).toEqual([]);
  });

  it("builds a single direct invocation chain from user prompt to role reply", () => {
    const messages: ImMessage[] = [
      {
        messageId: "msg-human-1",
        projectId: "p1",
        kind: "human",
        authorMemberId: null,
        authorLabel: "You",
        body: "@Architect Design search indexing",
        quoteIds: [],
        quotes: [],
        mentionRoleIds: ["m-arch"],
        jobId: "job-1",
        createdAtMs: 1000
      },
      {
        messageId: "msg-arch-1",
        projectId: "p1",
        kind: "role.say",
        authorMemberId: "m-arch",
        authorLabel: "Architect",
        body: "Here is the search index architecture design.",
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
        memberId: "m-arch",
        messageId: "msg-human-1",
        acpChatId: "chat-1",
        status: "completed",
        brief: { persona: "", instruction: "Design search indexing", cwd: "/tmp", quotes: [], knowledge: [] },
        error: null,
        filesChanged: ["docs/arch.md"],
        permission: null,
        createdAtMs: 1000,
        updatedAtMs: 2000,
        finishedAtMs: 2000
      }
    ];

    const summary = buildCallChains(messages, jobs, members, formatters);
    expect(summary.totalChains).toBe(1);
    expect(summary.totalNodes).toBe(2);
    expect(summary.chains[0]?.title).toContain("Design search indexing");
    expect(summary.chains[0]?.root.children).toHaveLength(1);

    const archNode = summary.chains[0]?.root.children[0];
    expect(archNode?.authorLabel).toBe("Architect");
    expect(archNode?.triggerType).toBe("mention");
    expect(archNode?.status).toBe("completed");
    expect(archNode?.filesChanged).toEqual(["docs/arch.md"]);
    expect(archNode?.snippet).toContain("Here is the search index architecture design.");
  });

  it("builds nested delegation chain (Human -> Architect -> Developer with proposals)", () => {
    const messages: ImMessage[] = [
      {
        messageId: "msg-human-1",
        projectId: "p1",
        kind: "human",
        authorMemberId: null,
        authorLabel: "You",
        body: "Build the search engine",
        autoRouted: true,
        routedRoleName: "Architect",
        quoteIds: [],
        quotes: [],
        mentionRoleIds: ["m-arch"],
        jobId: "job-1",
        createdAtMs: 1000
      },
      {
        messageId: "msg-arch-1",
        projectId: "p1",
        kind: "role.say",
        authorMemberId: "m-arch",
        authorLabel: "Architect",
        body: "Architecture is complete. Ready for implementation.",
        delegationProposals: [
          {
            id: "prop-1",
            targetTemplateId: "role_developer",
            targetRoleName: "Developer",
            instruction: "Implement the B-tree index in core.",
            reason: "Core indexing service",
            status: "auto_dispatched",
            dispatchedJobId: "job-dev-2",
            createdAtMs: 2000,
            resolvedAtMs: 2000
          },
          {
            id: "prop-2",
            targetTemplateId: "role_tester",
            targetRoleName: "Tester",
            instruction: "Verify boundary cases",
            reason: "QA validation",
            status: "pending",
            createdAtMs: 2000
          }
        ],
        quoteIds: [],
        quotes: [],
        mentionRoleIds: [],
        jobId: "job-1",
        createdAtMs: 2000
      },
      {
        messageId: "msg-dev-2",
        projectId: "p1",
        kind: "role.say",
        authorMemberId: "m-dev",
        authorLabel: "Developer",
        body: "Implemented B-tree index with tests passing.",
        quoteIds: [],
        quotes: [],
        mentionRoleIds: [],
        jobId: "job-dev-2",
        createdAtMs: 3000
      }
    ];

    const jobs: ImJob[] = [
      {
        jobId: "job-1",
        projectId: "p1",
        memberId: "m-arch",
        messageId: "msg-human-1",
        acpChatId: "chat-1",
        status: "completed",
        brief: { persona: "", instruction: "Build search engine", cwd: "/tmp", quotes: [], knowledge: [] },
        error: null,
        filesChanged: [],
        permission: null,
        createdAtMs: 1000,
        updatedAtMs: 2000,
        finishedAtMs: 2000
      },
      {
        jobId: "job-dev-2",
        projectId: "p1",
        memberId: "m-dev",
        messageId: null,
        acpChatId: "chat-2",
        status: "completed",
        brief: { persona: "", instruction: "Implement B-tree index", cwd: "/tmp", quotes: [], knowledge: [] },
        error: null,
        filesChanged: ["src/index/btree.ts", "src/index/btree.test.ts"],
        permission: null,
        createdAtMs: 2000,
        updatedAtMs: 3000,
        finishedAtMs: 3000
      }
    ];

    const summary = buildCallChains(messages, jobs, members, formatters);
    expect(summary.totalChains).toBe(1);
    // Root (Human) -> Architect -> [Developer (dispatched), Tester (pending proposal)] = 4 nodes
    expect(summary.totalNodes).toBe(4);

    const root = summary.chains[0]?.root;
    expect(root?.children).toHaveLength(1);

    const archNode = root?.children[0];
    expect(archNode?.authorLabel).toBe("Architect");
    expect(archNode?.triggerType).toBe("auto_routed");
    expect(archNode?.children).toHaveLength(2);

    const devNode = archNode?.children[0];
    expect(devNode?.authorLabel).toBe("Developer");
    expect(devNode?.triggerType).toBe("auto_dispatched");
    expect(devNode?.status).toBe("completed");
    expect(devNode?.filesChanged).toHaveLength(2);
    expect(devNode?.snippet).toContain("Implemented B-tree index");

    const pendingNode = archNode?.children[1];
    expect(pendingNode?.authorLabel).toBe("Tester");
    expect(pendingNode?.triggerType).toBe("pending_proposal");
    expect(pendingNode?.status).toBe("pending_proposal");
    expect(pendingNode?.reason).toBe("QA validation");
  });
});
