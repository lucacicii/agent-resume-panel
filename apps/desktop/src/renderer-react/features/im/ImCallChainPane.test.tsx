import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ImMember, ImRoom } from "../../../shared/imTypes";
import { ImCallChainPane } from "./ImCallChainPane";

const t = (key: string, ...args: Array<string | number>) => {
  if (key === "desktop.im.callChain") return "Invocation Chain";
  if (key === "desktop.im.callChainEmpty") return "No call chains yet";
  if (key === "desktop.im.callChainEmptyHint") return "When tasks are assigned to roles, the chain will appear here.";
  if (key === "desktop.im.callChainFilesChanged") return `${args[0]} files modified`;
  if (key === "desktop.im.callChainAutoRouted") return "Auto-routed";
  if (key === "desktop.im.callChainAutoDispatched") return "Auto-dispatched";
  if (key === "desktop.im.role.architect") return "Architect";
  if (key === "desktop.im.role.developer") return "Developer";
  if (key === "desktop.im.today") return "Today";
  return key;
};

describe("ImCallChainPane", () => {
  afterEach(() => {
    cleanup();
  });

  const members: ImMember[] = [
    {
      memberId: "m-arch",
      projectId: "p1",
      templateId: "role_architect",
      name: "Architect",
      persona: "Architect",
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
      persona: "Developer",
      agent: "claude",
      permissions: "write",
      tools: { fsRead: true, fsWrite: true, execute: true },
      enabled: true,
      acpChatId: null,
      createdAtMs: 1000,
      updatedAtMs: 1000
    }
  ];

  it("renders empty state when room has no messages", () => {
    const emptyRoom: ImRoom = {
      project: { projectId: "p1", name: "Test Room", localPath: null, createdAtMs: 1, updatedAtMs: 1 },
      members,
      messages: [],
      jobs: [],
      knowledge: []
    };

    render(
      <ImCallChainPane
        room={emptyRoom}
        allMembers={members}
        onJumpToMessage={vi.fn()}
        t={t}
      />
    );

    expect(screen.getByText("Invocation Chain")).toBeTruthy();
    expect(screen.getByText("No call chains yet")).toBeTruthy();
  });

  it("renders call chain hierarchy and invokes onJumpToMessage when clicked", () => {
    const room: ImRoom = {
      project: { projectId: "p1", name: "Test Room", localPath: null, createdAtMs: 1, updatedAtMs: 1 },
      members,
      messages: [
        {
          messageId: "msg-h-1",
          projectId: "p1",
          kind: "human",
          authorMemberId: null,
          authorLabel: "You",
          body: "Implement the login module",
          autoRouted: true,
          quoteIds: [],
          quotes: [],
          mentionRoleIds: ["m-arch"],
          jobId: "job-1",
          createdAtMs: 1000
        },
        {
          messageId: "msg-a-1",
          projectId: "p1",
          kind: "role.say",
          authorMemberId: "m-arch",
          authorLabel: "Architect",
          body: "Architecture for login module is ready.",
          delegationProposals: [
            {
              id: "prop-1",
              targetTemplateId: "role_developer",
              targetRoleName: "Developer",
              instruction: "Write the auth controllers.",
              status: "auto_dispatched",
              dispatchedJobId: "job-dev-1",
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
          messageId: "msg-d-1",
          projectId: "p1",
          kind: "role.say",
          authorMemberId: "m-dev",
          authorLabel: "Developer",
          body: "Auth controllers implemented.",
          quoteIds: [],
          quotes: [],
          mentionRoleIds: [],
          jobId: "job-dev-1",
          createdAtMs: 3000
        }
      ],
      jobs: [
        {
          jobId: "job-1",
          projectId: "p1",
          memberId: "m-arch",
          messageId: "msg-h-1",
          acpChatId: "chat-1",
          status: "completed",
          brief: { persona: "", instruction: "Implement login", cwd: "/tmp", quotes: [], knowledge: [] },
          error: null,
          filesChanged: [],
          permission: null,
          createdAtMs: 1000,
          updatedAtMs: 2000,
          finishedAtMs: 2000
        },
        {
          jobId: "job-dev-1",
          projectId: "p1",
          memberId: "m-dev",
          messageId: null,
          acpChatId: "chat-2",
          status: "completed",
          brief: { persona: "", instruction: "Write auth controllers", cwd: "/tmp", quotes: [], knowledge: [] },
          error: null,
          filesChanged: ["src/auth.ts"],
          permission: null,
          createdAtMs: 2000,
          updatedAtMs: 3000,
          finishedAtMs: 3000
        }
      ],
      knowledge: []
    };

    const onJump = vi.fn();
    render(
      <ImCallChainPane
        room={room}
        allMembers={members}
        onJumpToMessage={onJump}
        onClose={vi.fn()}
        t={t}
      />
    );

    expect(screen.getByText("You")).toBeTruthy();
    expect(screen.getByText("Architect")).toBeTruthy();
    expect(screen.getByText("Developer")).toBeTruthy();
    expect(screen.getByText("1 files modified")).toBeTruthy();

    // Clicking a node card triggers onJumpToMessage
    fireEvent.click(screen.getByText("Architect"));
    expect(onJump).toHaveBeenCalledWith("msg-a-1");
  });
});
