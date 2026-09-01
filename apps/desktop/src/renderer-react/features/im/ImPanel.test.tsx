import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { ImPanel } from "./ImPanel";
import type { ImProject, ImRoom } from "../../../shared/imTypes";

const messages = {
  "desktop.im.title": "IM",
  "desktop.im.chats": "Chats",
  "desktop.im.newChat": "New chat",
  "desktop.im.chatName": "Chat name",
  "desktop.im.untitledChat": "Untitled chat",
  "desktop.im.noChats": "No chats yet",
  "desktop.im.tempFolder": "Temporary folder",
  "desktop.im.renameChat": "Rename",
  "desktop.im.deleteChat": "Delete chat",
  "desktop.im.deleteChatConfirm": "Delete chat \"{0}\"? Associated agent sessions and temporary files will be removed.",
  "desktop.im.associateFolder": "Associate folder",
  "desktop.im.associateFolderTitle": "Select folder",
  "desktop.im.associateFolderFirst": "Associate a project folder first",
  "desktop.workbench.sidePanelExplorer": "Explorer",
  "desktop.workbench.resizeSidePanel": "Resize side panel",
  "desktop.im.toggleDetails": "Roles & Background",
  "desktop.im.selectChat": "Select or create a chat.",
  "desktop.im.configRole": "Configure role",
  "desktop.im.roleAgent": "Agent",
  "desktop.im.roleModel": "Model",
  "desktop.im.defaultModel": "Default (Follow template)",
  "desktop.im.roleThoughtLevel": "Thinking level",
  "desktop.im.defaultThoughtLevel": "Default (Agent default)",
  "desktop.im.thoughtLevel.low": "Low",
  "desktop.im.thoughtLevel.medium": "Medium",
  "desktop.im.thoughtLevel.high": "High",
  "desktop.im.customThoughtLevelOption": "Custom thinking level…",
  "desktop.settings.imThoughtLevelPlaceholder": "e.g. low, medium, high",
  "desktop.im.resetDefault": "Reset to default",
  "desktop.im.fetchModels": "Fetch models",
  "desktop.im.customBadge": "Custom",
  "desktop.im.customModelOption": "Custom model ID…",
  "desktop.workbench.autoRename": "Auto rename",
  "desktop.common.resend": "Resend",
  "desktop.common.revealInFinder": "Reveal in Finder",
  "desktop.im.emptyRoom": "Quote a message and @ a role to dispatch work.",
  "desktop.im.transcript": "Room transcript",
  "desktop.im.mentions": "Mentioned roles",
  "desktop.im.quote": "Quote",
  "desktop.im.continueAsk": "Ask again",
  "desktop.im.continuingWith": "Continuing with {0}",
  "desktop.im.removeFollowUp": "Stop continuing this reply",
  "desktop.im.newConversation": "New conversation",
  "desktop.im.translate": "Translate",
  "desktop.im.restore": "Restore",
  "desktop.im.explain": "Explain",
  "desktop.im.actionRunning": "Working…",
  "desktop.im.removeQuote": "Remove quote",
  "desktop.im.mention": "Mention a role",
  "desktop.im.removeMention": "Remove mention",
  "desktop.im.placeholder": "Message the room. @ a role. Enter to send, Shift+Enter for a new line.",
  "desktop.im.members": "Roles",
  "desktop.im.noMembers": "No roles in this room",
  "desktop.im.agentLabel": "Agent",
  "desktop.im.agent.pi": "Pi",
  "desktop.im.agent.claude": "Claude Code",
  "desktop.im.agent.codex": "Codex",
  "desktop.im.currentJob": "Current job",
  "desktop.im.thinking": "Thinking process",
  "desktop.im.filesModified": "Modified {0} files",
  "desktop.im.fileModifiedSingle": "Modified 1 file",
  "desktop.im.copyPath": "Copy path",
  "desktop.im.copiedPath": "Copied",
  "desktop.im.revealInWorkbench": "Reveal in Workbench",
  "desktop.im.typing": "Typing…",
  "desktop.im.connecting": "Connecting…",
  "desktop.im.inQueue": "Waiting in queue…",
  "desktop.im.permissionTitle": "Permission request",
  "desktop.im.job.queued": "Queued",
  "desktop.im.job.connecting": "Connecting",
  "desktop.im.job.running": "Running",
  "desktop.im.job.awaiting_user": "Waiting for you",
  "desktop.im.job.completed": "Finished",
  "desktop.im.job.failed": "Failed",
  "desktop.im.job.cancelled": "Cancelled",
  "desktop.im.resumeJob": "Continue",
  "desktop.im.jobInterrupted": "Interrupted before finishing. Saved draft is kept.",
  "desktop.common.showSidebar": "Show sidebar",
  "desktop.common.hideSidebar": "Hide sidebar",
  "desktop.common.confirm": "Confirm",
  "desktop.common.cancel": "Cancel",
  "desktop.common.send": "Send",
  "desktop.im.role.developer": "Developer",
  "desktop.im.role.architect": "Architect",
  "desktop.im.role.productManager": "Product Manager",
  "desktop.im.role.projectManager": "Project Manager",
  "desktop.im.role.uiDesigner": "UI Designer",
  "desktop.im.role.tester": "Tester",
  "desktop.im.dispatchTo": "Dispatch to @{0}",
  "desktop.im.delegationProposal": "Proposed delegation to {0}",
  "desktop.im.delegationApprove": "Approve & Dispatch",
  "desktop.im.delegationEdit": "Edit in Composer",
  "desktop.im.delegationDismiss": "Dismiss",
  "desktop.im.delegationStatus.pending": "Pending review",
  "desktop.im.delegationStatus.dispatched": "Dispatched",
  "desktop.im.delegationStatus.auto_dispatched": "Auto-dispatched",
  "desktop.im.delegationStatus.dismissed": "Dismissed",
  "desktop.im.autoRoutedTo": "Auto-assigned to @{0}",
  "desktop.im.routingTimeoutTip": "Intent analysis timed out (30s). You can use @ in the composer to manually assign a role.",
  "desktop.im.routingUnmatchedTip": "No matching role identified. You can use @ in the composer to assign a task.",
  "desktop.im.addRole": "Add role",
  "desktop.im.removeRole": "Remove from room",
  "desktop.im.roleName": "Role name",
  "desktop.im.rolePersona": "Persona",
  "desktop.im.knowledge": "Background",
  "desktop.im.knowledgeEmpty": "Add text, links, or images for this room.",
  "desktop.im.knowledgeTitle": "Title",
  "desktop.im.knowledgeText": "Text",
  "desktop.im.knowledgeUrl": "https://",
  "desktop.im.addText": "Add text",
  "desktop.im.addLink": "Add link",
  "desktop.im.addImage": "Add image",
  "desktop.agent.toolsOn": "Tools on",
  "desktop.agent.toolsOffTitle": "Tools off",
  "desktop.agent.toolsToggle": "Tools toggle",
  "desktop.agent.toolsDialogTitle": "Tools",
  "desktop.agent.toolsModeTitle": "Tool mode",
  "desktop.agent.toolsMode.auto": "Auto",
  "desktop.agent.toolsMode.custom": "Custom",
  "desktop.agent.toolsMode.off": "Off",
  "desktop.agent.toolsSelectAll": "All",
  "desktop.agent.toolsClearAll": "None",
  "desktop.agent.toolsCustomEmpty": "No tools selected",
  "desktop.agent.toolsFoot": "Auto lets the assistant choose",
  "desktop.agent.toolCategory.notes": "Notes",
  "desktop.agent.toolCategory.reports": "Reports",
  "desktop.agent.toolCategory.sessions": "Sessions",
  "desktop.agent.toolCategory.projects": "Projects",
  "desktop.agent.toolCategory.link_graph": "Link graph",
  "desktop.agent.toolCategory.tags": "Tags",
  "desktop.agent.toolCategory.skills": "Skills",
  "desktop.agent.toolCategory.browser": "Browser",
  "desktop.agent.toolCategory.mcp": "MCP",
  "desktop.im.removeKnowledge": "Remove"
};

function project(overrides: Partial<ImProject> = {}): ImProject {
  return {
    projectId: "proj-1",
    name: "Room One",
    localPath: "/tmp/app",
    createdAtMs: 1,
    updatedAtMs: 1,
    ...overrides
  };
}

function member(
  nextProject: ImProject,
  templateId: string,
  name: string,
  memberId: string
): ImRoom["members"][number] {
  return {
    memberId,
    projectId: nextProject.projectId,
    templateId,
    name,
    persona: `You are ${name}.`,
    agent: "claude",
    permissions: templateId === "role_developer" ? "write" : "read",
    tools: {
      fsRead: true,
      fsWrite: templateId === "role_developer",
      execute: templateId === "role_developer" || templateId === "role_tester"
    },
    enabled: true,
    acpChatId: null,
    createdAtMs: 1,
    updatedAtMs: 1
  };
}

function roomFor(nextProject: ImProject): ImRoom {
  return {
    project: nextProject,
    members: [
      member(nextProject, "role_product_manager", "Product Manager", "mem-pm"),
      member(nextProject, "role_architect", "Architect", "mem-arch"),
      member(nextProject, "role_project_manager", "Project Manager", "mem-pj"),
      member(nextProject, "role_ui_designer", "UI Designer", "mem-ui"),
      member(nextProject, "role_developer", "Developer", "mem-dev"),
      member(nextProject, "role_tester", "Tester", "mem-qa")
    ],
    messages: [],
    jobs: [],
    knowledge: []
  };
}

function renderIm() {
  const created = project();
  window.agentResume = {
    getI18nBundle: async () => ({ locale: "en", messages }),
    onLocaleChanged: () => () => undefined,
    imListProjects: vi.fn(async () => [created]),
    imCreateProject: vi.fn(async ({ name }: { name: string }) => project({ name, localPath: `/tmp/scratch/${name}` })),
    imRenameProject: vi.fn(async ({ projectId, name }: { projectId: string; name: string }) => project({ projectId, name })),
    imAutoRenameProject: vi.fn(async ({ projectId }: { projectId: string }) => project({ projectId, name: "Auto Renamed Chat" })),
    imDeleteProject: vi.fn(async () => ({ ok: true })),
    imGetRoom: vi.fn(async () => roomFor(created)),
    imPickLocalPath: vi.fn(async () => ({ ok: true as const, path: "/tmp/app" })),
    imSetLocalPath: vi.fn(async ({ projectId, localPath }: { projectId: string; localPath: string | null }) => project({ projectId, localPath })),
    revealProjectInFinder: vi.fn(async () => ({ ok: true, path: created.localPath })),
    clipboardWriteText: vi.fn(async () => undefined),
    workbenchOpenPath: vi.fn(async () => ({ ok: true })),
    workbenchRevealPath: vi.fn(async () => ({ ok: true })),
    workbenchListDirectory: vi.fn(async ({ dirPath }: { dirPath: string }) => ({
      entries: dirPath === "/tmp/app"
        ? [{ name: "package.json", path: "/tmp/app/package.json", isDirectory: false }]
        : []
    })),
    workbenchListScripts: vi.fn(async () => ({ packages: [], truncated: false, scannedDirs: 0 })),
    workbenchSearchText: vi.fn(async () => ({ matches: [], truncated: false, filesSearched: 0, engine: "node" })),
    workbenchSearchTextCancel: vi.fn(async () => ({ ok: true })),
    listAgentTools: vi.fn(async () => []),
    terminalGitStatus: vi.fn(async () => ({
      isRepo: true,
      root: created.localPath,
      staged: [],
      unstaged: [],
      tracking: [{ repoRoot: created.localPath, branch: "main", upstream: null, ahead: 0, behind: 0 }]
    })),
    imListTemplates: vi.fn(async () => roomFor(created).members.map((item) => ({
      templateId: item.templateId,
      name: item.name,
      persona: item.persona,
      agent: item.agent,
      permissions: item.permissions,
      tools: item.tools,
      createdAtMs: 1,
      updatedAtMs: 1
    }))),
    imListSelectionActions: vi.fn(async () => [
      { actionId: "quote", name: "Quote", kind: "context", prompt: "", sortOrder: 0, enabled: true, createdAtMs: 1, updatedAtMs: 1 },
      { actionId: "translate", name: "Translate", kind: "independent", prompt: "Translate:\n{selection}", sortOrder: 1, enabled: true, createdAtMs: 1, updatedAtMs: 1 },
      { actionId: "explain", name: "Explain", kind: "independent", prompt: "Explain:\n{selection}", sortOrder: 2, enabled: true, createdAtMs: 1, updatedAtMs: 1 }
    ]),
    imRunSelectionAction: vi.fn(async () => ({ text: "translated" })),
    imAddMember: vi.fn(async () => roomFor(created).members[0]),
    imRemoveMember: vi.fn(async () => ({ ok: true })),
    imSetMemberAgent: vi.fn(async ({ memberId, agent }: { memberId: string; agent: string }) => {
      const mem = roomFor(created).members.find((m) => m.memberId === memberId) || roomFor(created).members[0]!;
      return { ...mem, agent };
    }),
    imSetMemberModel: vi.fn(async ({ memberId, model }: { memberId: string; model: string | null }) => {
      const mem = roomFor(created).members.find((m) => m.memberId === memberId) || roomFor(created).members[0]!;
      return { ...mem, model: model ?? undefined };
    }),
    imSetMemberThoughtLevel: vi.fn(async ({ memberId, thoughtLevel }: { memberId: string; thoughtLevel: string | null }) => {
      const mem = roomFor(created).members.find((m) => m.memberId === memberId) || roomFor(created).members[0]!;
      return { ...mem, thoughtLevel: thoughtLevel ?? undefined };
    }),
    imResetMemberOverrides: vi.fn(async ({ memberId }: { memberId: string }) => {
      const mem = roomFor(created).members.find((m) => m.memberId === memberId) || roomFor(created).members[0]!;
      return { ...mem, agent: "claude", model: undefined, thoughtLevel: undefined };
    }),
    imListAgentModels: vi.fn(async ({ agent }: { agent: string }) => {
      if (agent === "codex") {
        return [
          { id: "", label: "Default" },
          { id: "o3-mini", label: "o3-mini" },
          { id: "gpt-4o", label: "GPT-4o" }
        ];
      }
      return [
        { id: "", label: "Default" },
        { id: "claude-3-7-sonnet-20250219", label: "Claude 3.7 Sonnet" }
      ];
    }),
    imResumeJob: vi.fn(async () => ({ job: { jobId: "j-resume" } })),
    imPostMessage: vi.fn(async () => ({
      message: {
        messageId: "m1",
        projectId: created.projectId,
        kind: "human",
        authorMemberId: null,
        authorLabel: "You",
        body: "hello",
        quoteIds: [],
        quotes: [],
        mentionRoleIds: [],
        jobId: null,
        createdAtMs: Date.now()
      },
      job: null
    })),
    imDispatchProposal: vi.fn(async () => ({
      message: {
        messageId: "m-prop",
        projectId: created.projectId,
        kind: "role.say",
        authorMemberId: "mem-arch",
        authorLabel: "Architect",
        body: "Design complete.",
        quoteIds: [],
        quotes: [],
        mentionRoleIds: [],
        jobId: "j-arch",
        delegationProposals: [{
          id: "prop-1",
          targetTemplateId: "role_developer",
          targetRoleName: "Developer",
          instruction: "Implement backend",
          status: "dispatched",
          createdAtMs: 1
        }],
        createdAtMs: 1
      },
      job: {
        jobId: "j-dev",
        projectId: created.projectId,
        memberId: "mem-dev",
        messageId: null,
        brief: { persona: "", instruction: "Implement backend", cwd: "/tmp", quotes: [], knowledge: [] },
        status: "queued" as const,
        filesChanged: [],
        error: null,
        acpChatId: null,
        permission: null,
        finished: false,
        finishedAtMs: null,
        createdAtMs: 1,
        updatedAtMs: 1
      }
    })),
    imDismissProposal: vi.fn(async () => ({
      messageId: "m-prop",
      projectId: created.projectId,
      kind: "role.say",
      authorMemberId: "mem-arch",
      authorLabel: "Architect",
      body: "Design complete.",
      quoteIds: [],
      quotes: [],
      mentionRoleIds: [],
      jobId: "j-arch",
      delegationProposals: [{
        id: "prop-1",
        targetTemplateId: "role_developer",
        targetRoleName: "Developer",
        instruction: "Implement backend",
        status: "dismissed",
        createdAtMs: 1
      }],
      createdAtMs: 1
    })),
    onWorkbenchCmdT: (callback: () => void) => {
      const handler = () => callback();
      window.addEventListener("test:cmd-t", handler);
      return () => window.removeEventListener("test:cmd-t", handler);
    },
    onImEvent: () => () => undefined
  } as unknown as typeof window.agentResume;

  render(
    <I18nProvider>
      <ImPanel />
    </I18nProvider>
  );
  return window.agentResume;
}

describe("ImPanel", () => {
  beforeEach(() => {
    localStorage.clear();
    const host = document.createElement("div");
    host.id = "react-im";
    document.body.appendChild(host);
    const headerSlot = document.createElement("div");
    headerSlot.id = "app-header-slot";
    document.body.appendChild(headerSlot);
  });
  afterEach(() => {
    cleanup();
    document.querySelectorAll("#react-im, #app-header-slot").forEach((node) => node.remove());
  });

  it("loads a user-created IM project instead of catalog projects", async () => {
    renderIm();
    await act(async () => {
      window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "im" }));
    });
    expect(await screen.findByRole("button", { name: /Room One/ })).toBeTruthy();
    expect(screen.queryByText("All projects")).toBeNull();
  });

  it("shows builtin roles in the room sidebar", async () => {
    renderIm();
    await act(async () => {
      window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "im" }));
    });
    expect(await screen.findByText("Product Manager")).toBeTruthy();
    expect(screen.getByText("Architect")).toBeTruthy();
    expect(screen.getByText("Project Manager")).toBeTruthy();
    expect(screen.getByText("UI Designer")).toBeTruthy();
    expect(screen.getByText("Developer")).toBeTruthy();
    expect(screen.getByText("Tester")).toBeTruthy();
    expect(screen.getAllByRole("checkbox")).toHaveLength(6);
  });

  it("keeps multiple mention chips after picking two roles", async () => {
    renderIm();
    await act(async () => {
      window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "im" }));
    });
    const composer = await screen.findByLabelText("Message the room. @ a role. Enter to send, Shift+Enter for a new line.");
    fireEvent.keyDown(composer, { key: "@" });
    fireEvent.click(await screen.findByRole("option", { name: /Product Manager/ }));
    fireEvent.keyDown(composer, { key: "@" });
    fireEvent.click(await screen.findByRole("option", { name: /Developer/ }));
    expect(screen.getAllByLabelText("Remove mention")).toHaveLength(2);
  });

  it("opens an @ mention list and moves the active option with arrow keys", async () => {
    renderIm();
    await act(async () => {
      window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "im" }));
    });
    const composer = await screen.findByLabelText("Message the room. @ a role. Enter to send, Shift+Enter for a new line.");
    fireEvent.keyDown(composer, { key: "@" });
    const list = await screen.findByRole("listbox", { name: "Mention a role" });
    const first = screen.getByRole("option", { name: /Product Manager/ });
    expect(first.getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(composer, { key: "ArrowDown" });
    await waitFor(() => {
      expect(screen.getByRole("option", { name: /Architect/ }).getAttribute("aria-selected")).toBe("true");
    });
    expect(list.querySelector(".active")?.textContent).toMatch(/Architect/);
  });

  it("hides tool-call job cards and keeps the role answer", async () => {
    const api = renderIm();
    const next = roomFor(project());
    (api.imGetRoom as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...next,
      messages: [
        {
          messageId: "tool-card",
          projectId: "proj-1",
          kind: "job.card",
          authorMemberId: "mem-pm",
          authorLabel: "Job",
          body: "Read · README.md",
          quoteIds: [],
          quotes: [],
          mentionRoleIds: [],
          jobId: "job-1",
          createdAtMs: 1
        },
        {
          messageId: "answer",
          projectId: "proj-1",
          kind: "role.say",
          authorMemberId: "mem-pm",
          authorLabel: "Product Manager",
          body: "The repo is a **desktop** IM app.",
          quoteIds: [],
          quotes: [],
          mentionRoleIds: [],
          jobId: "job-1",
          createdAtMs: 2
        }
      ],
      jobs: [{
        jobId: "job-1",
        projectId: "proj-1",
        memberId: "mem-pm",
        messageId: null,
        acpChatId: "chat-1",
        status: "completed",
        brief: { persona: "You are Product Manager.", instruction: "summarize", cwd: "/tmp/app", quotes: [], knowledge: [] },
        error: null,
        filesChanged: [],
        permission: null,
        createdAtMs: 1,
        updatedAtMs: 2,
        finishedAtMs: 2
      }]
    });
    await act(async () => {
      window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "im" }));
    });
    expect(await screen.findByText("desktop")).toBeTruthy();
    expect(document.querySelector(".im-message.is-role-say .markdown-body strong")?.textContent).toBe("desktop");
    expect(screen.queryByText("Read · README.md")).toBeNull();
    expect(document.querySelector(".im-message.is-role-say")).toBeTruthy();
  });

  it("opens a selection menu and quotes the highlighted text", async () => {
    const api = renderIm();
    const next = roomFor(project());
    (api.imGetRoom as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...next,
      messages: [{
        messageId: "answer",
        projectId: "proj-1",
        kind: "role.say",
        authorMemberId: "mem-pm",
        authorLabel: "Product Manager",
        body: "Keep the helper.",
        quoteIds: [],
        quotes: [],
        mentionRoleIds: [],
        jobId: null,
        createdAtMs: 1
      }]
    });
    await act(async () => {
      window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "im" }));
    });
    const body = document.querySelector(".im-message .markdown-body") as HTMLElement;
    expect(body).toBeTruthy();
    const range = document.createRange();
    range.selectNodeContents(body);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    fireEvent.contextMenu(body);
    expect(await screen.findByRole("menuitem", { name: "Quote" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Translate" })).toBeTruthy();
    fireEvent.click(screen.getByRole("menuitem", { name: "Quote" }));
    await waitFor(() => expect(screen.getByLabelText("Remove quote")).toBeTruthy());
  });

  it("renders the @-mentioned roles on the message in the transcript", async () => {
    const api = renderIm();
    const next = roomFor(project());
    (api.imGetRoom as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...next,
      messages: [{
        messageId: "m1",
        projectId: "proj-1",
        kind: "human",
        authorMemberId: null,
        authorLabel: "You",
        body: "please implement this",
        quoteIds: [],
        quotes: [],
        mentionRoleIds: ["mem-pm", "mem-dev"],
        jobId: null,
        createdAtMs: 1
      }]
    });
    await act(async () => {
      window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "im" }));
    });
    await waitFor(() => expect(document.querySelector(".im-message-mentions")).toBeTruthy());
    const chips = [...document.querySelectorAll(".im-message-mention")].map((item) => item.textContent);
    expect(chips).toEqual(["@Product Manager", "@Developer"]);
  });

  it("translates a message inline and restores the original via the tag", async () => {
    const api = renderIm();
    const next = roomFor(project());
    (api.imGetRoom as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...next,
      messages: [{
        messageId: "msg-translate",
        projectId: "proj-1",
        kind: "role.say",
        authorMemberId: "mem-pm",
        authorLabel: "Product Manager",
        body: "Hello world",
        quoteIds: [],
        quotes: [],
        mentionRoleIds: [],
        jobId: null,
        createdAtMs: 1
      }]
    });
    await act(async () => {
      window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "im" }));
    });
    const translateTag = await screen.findByRole("button", { name: "Translate" });
    fireEvent.click(translateTag);
    await waitFor(() => expect(api.imRunSelectionAction).toHaveBeenCalledWith({ actionId: "translate", text: "Hello world" }));
    await waitFor(() => expect(screen.getByText("translated")).toBeTruthy());
    expect(screen.queryByText("Hello world")).toBeNull();
    const restoreTag = screen.getByRole("button", { name: "Restore" });
    fireEvent.click(restoreTag);
    await waitFor(() => expect(screen.getByText("Hello world")).toBeTruthy());
    expect(screen.queryByText("translated")).toBeNull();
  });

  it("opens the context menu on the whole message without a selection", async () => {
    const api = renderIm();
    const next = roomFor(project());
    (api.imGetRoom as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...next,
      messages: [{
        messageId: "full",
        projectId: "proj-1",
        kind: "role.say",
        authorMemberId: "mem-pm",
        authorLabel: "Product Manager",
        body: "Whole message body",
        quoteIds: [],
        quotes: [],
        mentionRoleIds: [],
        jobId: null,
        createdAtMs: 1
      }]
    });
    await act(async () => {
      window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "im" }));
    });
    window.getSelection()?.removeAllRanges();
    const article = document.querySelector(".im-message") as HTMLElement;
    fireEvent.contextMenu(article);
    expect(await screen.findByRole("menuitem", { name: "Quote" })).toBeTruthy();
    fireEvent.click(screen.getByRole("menuitem", { name: "Quote" }));
    const chip = await screen.findByLabelText("Remove quote");
    expect(chip.textContent).toContain("Whole message body");
    expect(screen.queryByRole("menuitem", { name: "Resend" })).toBeNull();
  });

  it("shows Resend in context menu for human messages and fills composer draft and mentions", async () => {
    const api = renderIm();
    const next = roomFor(project());
    (api.imGetRoom as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...next,
      messages: [{
        messageId: "user-msg-1",
        projectId: "proj-1",
        kind: "human",
        authorMemberId: null,
        authorLabel: "You",
        body: "Please refactor the database migration logic",
        quoteIds: [],
        quotes: [],
        mentionRoleIds: [next.members[0]!.memberId],
        jobId: null,
        createdAtMs: 1000
      }]
    });
    await act(async () => {
      window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "im" }));
    });
    await waitFor(() => expect(document.querySelector(".im-message.is-human")).not.toBeNull());
    window.getSelection()?.removeAllRanges();
    const article = document.querySelector(".im-message.is-human") as HTMLElement;
    expect(article).not.toBeNull();
    fireEvent.contextMenu(article);
    const resendBtn = await screen.findByRole("menuitem", { name: "Resend" });
    expect(resendBtn).toBeTruthy();
    fireEvent.click(resendBtn);
    const textarea = document.querySelector(".im-composer textarea") as HTMLTextAreaElement;
    expect(textarea.value).toBe("Please refactor the database migration logic");
    expect(document.activeElement).toBe(textarea);
    expect(screen.getByLabelText("Remove mention")).toBeTruthy();
  });

  it("runs an independent action and shows the result popover", async () => {
    const api = renderIm();
    const next = roomFor(project());
    (api.imGetRoom as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...next,
      messages: [{
        messageId: "answer",
        projectId: "proj-1",
        kind: "role.say",
        authorMemberId: "mem-pm",
        authorLabel: "Product Manager",
        body: "Keep the helper.",
        quoteIds: [],
        quotes: [],
        mentionRoleIds: [],
        jobId: null,
        createdAtMs: 1
      }]
    });
    await act(async () => {
      window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "im" }));
    });
    const body = document.querySelector(".im-message .markdown-body") as HTMLElement;
    const range = document.createRange();
    range.selectNodeContents(body);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    fireEvent.contextMenu(body);
    fireEvent.click(await screen.findByRole("menuitem", { name: "Translate" }));
    await waitFor(() => expect(api.imRunSelectionAction).toHaveBeenCalledWith({ actionId: "translate", text: "Keep the helper." }));
    await waitFor(() => expect(screen.getByRole("dialog", { name: "Translate" })).toBeTruthy());
    await waitFor(() => expect(screen.getByText("translated")).toBeTruthy());
  });

  it("quotes a message into the composer", async () => {
    const api = renderIm();
    (api.imGetRoom as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...roomFor(project()),
      messages: [{
        messageId: "quoted",
        projectId: "proj-1",
        kind: "human",
        authorMemberId: null,
        authorLabel: "You",
        body: "Keep the existing helper.",
        quoteIds: [],
        quotes: [],
        mentionRoleIds: [],
        jobId: null,
        createdAtMs: 1
      }]
    });
    await act(async () => {
      window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "im" }));
    });
    const quote = document.querySelector(".im-quote-btn") as HTMLElement;
    expect(quote).toBeTruthy();
    fireEvent.click(quote);
    await waitFor(() => expect(screen.getByLabelText("Remove quote")).toBeTruthy());
  });

  it("renders the needs-attention banner when a job is waiting on user permission", async () => {
    const currentProject = project();
    const currentRoom = roomFor(currentProject);
    const api = renderIm();
    (api.imGetRoom as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...currentRoom,
      jobs: [
        {
          jobId: "job-waiting-1",
          projectId: currentProject.projectId,
          memberId: currentRoom.members[0]!.memberId,
          messageId: "msg-1",
          acpChatId: "chat-1",
          status: "awaiting_user",
          brief: { persona: "", instruction: "", cwd: "/tmp/app", quotes: [], knowledge: [] },
          error: null,
          filesChanged: [],
          permission: {
            requestId: "req-1",
            title: "Approve command",
            options: [{ optionId: "allow", name: "Allow", kind: "button" }]
          },
          createdAtMs: 1,
          updatedAtMs: 1,
          finishedAtMs: null
        }
      ]
    });
    await act(async () => {
      window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "im" }));
    });
    await waitFor(() => expect(document.querySelector(".im-active-jobs-banner")).not.toBeNull());
    expect(document.querySelector(".im-active-jobs-banner")?.textContent).toContain("Current job");
    expect(document.querySelector(".im-active-jobs-banner")?.textContent).toContain("Waiting for you");
  });

  it("renders floating timeline when room has multiple messages and navigates on node click", async () => {
    const scrollIntoViewMock = vi.fn();
    window.HTMLElement.prototype.scrollIntoView = scrollIntoViewMock;

    const currentProject = project();
    const currentRoom = roomFor(currentProject);
    const api = renderIm();
    (api.imGetRoom as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...currentRoom,
      messages: [
        {
          messageId: "msg-1",
          projectId: currentProject.projectId,
          kind: "human",
          authorMemberId: null,
          authorLabel: "You",
          body: "First message",
          quoteIds: [],
          quotes: [],
          mentionRoleIds: [],
          jobId: null,
          createdAtMs: 1000
        },
        {
          messageId: "msg-2",
          projectId: currentProject.projectId,
          kind: "role.say",
          authorMemberId: currentRoom.members[0]!.memberId,
          authorLabel: "Developer",
          body: "Second message",
          quoteIds: [],
          quotes: [],
          mentionRoleIds: [],
          jobId: "j1",
          createdAtMs: 2000
        },
        {
          messageId: "msg-3",
          projectId: currentProject.projectId,
          kind: "human",
          authorMemberId: null,
          authorLabel: "You",
          body: "Third message",
          quoteIds: [],
          quotes: [],
          mentionRoleIds: [],
          jobId: null,
          createdAtMs: 3000
        }
      ]
    });
    await act(async () => {
      window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "im" }));
    });

    await waitFor(() => expect(document.querySelector(".im-timeline")).not.toBeNull());
    const nodes = document.querySelectorAll(".im-timeline-node");
    expect(nodes).toHaveLength(3);

    // Hover to trigger preview popover and macOS dock magnification effect
    fireEvent.mouseEnter(nodes[1]!);
    expect(document.querySelector(".im-timeline-popover")).not.toBeNull();
    expect(document.querySelector(".im-timeline-popover-author")?.textContent).toBe("Product Manager");
    expect(document.querySelector(".im-timeline-popover-snippet")?.textContent).toBe("Second message");
    expect(nodes[1]?.classList.contains("is-dock-focused")).toBe(true);
    expect(nodes[0]?.classList.contains("is-dock-neighbor-1")).toBe(true);
    expect(nodes[2]?.classList.contains("is-dock-neighbor-1")).toBe(true);

    // Mouse leave resets dock focus
    fireEvent.mouseLeave(document.querySelector(".im-timeline")!);
    expect(document.querySelector(".im-timeline-popover")).toBeNull();
    expect(nodes[1]?.classList.contains("is-dock-focused")).toBe(false);

    fireEvent.click(nodes[0]!);
    expect(scrollIntoViewMock).toHaveBeenCalled();
  });

  it("renders thinking collapsed by default and expands on toggle click, and shows streaming cursor", async () => {
    const currentProject = project();
    const currentRoom = roomFor(currentProject);
    const api = renderIm();
    (api.imGetRoom as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...currentRoom,
      messages: [
        {
          messageId: "msg-streaming",
          projectId: currentProject.projectId,
          kind: "role.say",
          authorMemberId: currentRoom.members[0]!.memberId,
          authorLabel: "Developer",
          body: "Partial streaming content",
          thinking: "Deep thought analysis",
          streaming: true,
          quoteIds: [],
          quotes: [],
          mentionRoleIds: [],
          jobId: "j1",
          createdAtMs: 1000
        }
      ]
    });
    await act(async () => {
      window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "im" }));
    });

    await waitFor(() => expect(document.querySelector(".im-message-thinking")).not.toBeNull());
    // Thinking toggle exists
    const toggle = document.querySelector(".im-message-thinking-toggle") as HTMLButtonElement;
    expect(toggle).not.toBeNull();
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    // Body is not visible by default
    expect(document.querySelector(".im-message-thinking-body")).toBeNull();
    // Streaming cursor is visible
    expect(document.querySelector(".im-streaming-cursor")).not.toBeNull();

    // Click to expand
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(document.querySelector(".im-message-thinking-body")).not.toBeNull();
    expect(document.querySelector(".im-message-thinking-body")?.textContent).toContain("Deep thought analysis");
  });

  it("renders image thumbnails in message bubbles and opens lightbox on click", async () => {
    const currentProject = project();
    const currentRoom = roomFor(currentProject);
    const api = renderIm();
    (api.imGetRoom as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...currentRoom,
      messages: [
        {
          messageId: "msg-img-1",
          projectId: currentProject.projectId,
          kind: "human",
          authorMemberId: null,
          authorLabel: "You",
          body: "Check this screenshot",
          images: [
            {
              id: "img-1",
              fileName: "screenshot.png",
              mimeType: "image/png",
              storagePath: ".desktop/im/screenshot.png",
              previewUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
            }
          ],
          quoteIds: [],
          quotes: [],
          mentionRoleIds: [],
          jobId: null,
          createdAtMs: 1000
        }
      ]
    });
    await act(async () => {
      window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "im" }));
    });

    await waitFor(() => expect(document.querySelector(".im-message-images")).not.toBeNull());
    const card = document.querySelector(".im-message-image-card") as HTMLButtonElement;
    expect(card).not.toBeNull();
    expect(card.textContent).toContain("screenshot.png");

    // Click to open lightbox
    fireEvent.click(card);
    expect(document.querySelector(".im-image-lightbox")).not.toBeNull();

    // Click close button
    const closeBtn = document.querySelector(".im-image-lightbox-close") as HTMLButtonElement;
    fireEvent.click(closeBtn);
    expect(document.querySelector(".im-image-lightbox")).toBeNull();
  });

  it("renders in-chat typing/status bubbles immediately when active jobs are dispatched", async () => {
    const currentProject = project();
    const currentRoom = roomFor(currentProject);
    const api = renderIm();
    (api.imGetRoom as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...currentRoom,
      messages: [
        {
          messageId: "msg-user-1",
          projectId: currentProject.projectId,
          kind: "human",
          authorMemberId: null,
          authorLabel: "You",
          body: "@Developer please implement auth",
          quoteIds: [],
          quotes: [],
          mentionRoleIds: [currentRoom.members[0]!.memberId],
          jobId: null,
          createdAtMs: 1000
        }
      ],
      jobs: [
        {
          jobId: "job-running-now",
          projectId: currentProject.projectId,
          memberId: currentRoom.members[0]!.memberId,
          messageId: "msg-user-1",
          acpChatId: "chat-1",
          status: "running",
          brief: { persona: "", instruction: "implement auth", cwd: "/tmp", quotes: [], knowledge: [] },
          error: null,
          filesChanged: [],
          permission: null,
          createdAtMs: 1000,
          updatedAtMs: 1000,
          finishedAtMs: null
        }
      ]
    });
    await act(async () => {
      window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "im" }));
    });

    await waitFor(() => expect(document.querySelector(".im-message.is-pending-job")).not.toBeNull());
    const pendingBubble = document.querySelector(".im-message.is-pending-job");
    expect(pendingBubble?.textContent).toContain("Product Manager");
    expect(pendingBubble?.textContent).toContain("Typing…");
    expect(document.querySelector(".im-jumping-dots")).not.toBeNull();
  });

  it("toggles right sidebar containing roles and background when clicking the toggle button", async () => {
    const currentProject = project();
    const currentRoom = roomFor(currentProject);
    const api = renderIm();
    (api.imGetRoom as ReturnType<typeof vi.fn>).mockResolvedValue(currentRoom);

    await act(async () => {
      window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "im" }));
    });

    await waitFor(() => expect(document.querySelector(".im-members")).not.toBeNull());
    const toggleBtn = screen.getByRole("button", { name: "Roles & Background" });
    expect(toggleBtn).not.toBeNull();

    // Click to hide right sidebar
    fireEvent.click(toggleBtn);
    expect(document.querySelector(".im-members")).toBeNull();

    // Click to show right sidebar again
    fireEvent.click(toggleBtn);
    expect(document.querySelector(".im-members")).not.toBeNull();
  });

  it("opens a chat context menu with rename, auto rename, and associate folder actions", async () => {
    const api = renderIm();
    await act(async () => {
      window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "im" }));
    });
    const row = await screen.findByRole("button", { name: /Room One/ });
    fireEvent.contextMenu(row);
    expect(await screen.findByRole("menuitem", { name: "Auto rename" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Rename" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Associate folder" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Reveal in Finder" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Delete chat" })).toBeTruthy();

    fireEvent.click(screen.getByRole("menuitem", { name: "Auto rename" }));
    await waitFor(() => expect(api.imAutoRenameProject).toHaveBeenCalledWith({
      projectId: "proj-1"
    }));
  });

  it("starts a new chat from Cmd+T shortcut and IPC event immediately", async () => {
    const api = renderIm();
    await act(async () => {
      window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "im" }));
    });
    expect(await screen.findByRole("button", { name: /New chat/ })).toBeTruthy();
    
    // Trigger via IPC event emitted on Electron before-input-event
    await act(async () => {
      window.dispatchEvent(new CustomEvent("test:cmd-t"));
    });
    await waitFor(() => expect(api.imCreateProject).toHaveBeenCalledWith({
      name: "Untitled chat"
    }));
  });

  it("configures custom agent and model per chat member and loads models automatically", async () => {
    const currentProject = project();
    const currentRoom = roomFor(currentProject);
    const api = renderIm();
    (api.imGetRoom as ReturnType<typeof vi.fn>).mockResolvedValue(currentRoom);

    await act(async () => {
      window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "im" }));
    });

    await waitFor(() => expect(document.querySelector(".im-members")).not.toBeNull());
    const configButtons = screen.getAllByRole("button", { name: "Configure role" });
    expect(configButtons.length).toBeGreaterThan(0);

    // Open first member's configuration
    fireEvent.click(configButtons[0]!);
    expect(await screen.findByDisplayValue("Claude Code")).toBeTruthy();

    // Change agent to Codex -> auto fetches models
    const agentSelect = screen.getByDisplayValue("Claude Code");
    fireEvent.change(agentSelect, { target: { value: "codex" } });

    await waitFor(() => expect(api.imSetMemberAgent).toHaveBeenCalledWith({
      memberId: "mem-pm",
      agent: "codex"
    }));
    await waitFor(() => expect(api.imListAgentModels).toHaveBeenCalledWith({
      agent: "codex"
    }));

    // Change model via dropdown
    const modelSelect = screen.getByDisplayValue("Default (Follow template)");
    fireEvent.change(modelSelect, { target: { value: "o3-mini" } });
    await waitFor(() => expect(api.imSetMemberModel).toHaveBeenCalledWith({
      memberId: "mem-pm",
      model: "o3-mini"
    }));

    const thoughtSelect = screen.getByDisplayValue("Default (Agent default)");
    fireEvent.change(thoughtSelect, { target: { value: "high" } });
    await waitFor(() => expect(api.imSetMemberThoughtLevel).toHaveBeenCalledWith({
      memberId: "mem-pm",
      thoughtLevel: "high"
    }));
  });

  it("renders modified files block on assistant messages linked to jobs with file changes", async () => {
    const currentProject = project({ localPath: "/workspace/project" });
    const currentRoom = roomFor(currentProject);
    const dev = currentRoom.members.find((m) => m.templateId === "role_developer")!;
    const testJob = {
      jobId: "job-files-1",
      projectId: currentProject.projectId,
      memberId: dev.memberId,
      messageId: null,
      brief: { persona: dev.persona, instruction: "code", cwd: "/workspace/project", quotes: [], knowledge: [] },
      status: "completed" as const,
      filesChanged: ["src/components/Header.tsx", "src/styles.css"],
      error: null,
      acpChatId: null,
      permission: null,
      finished: true,
      finishedAtMs: 2000,
      createdAtMs: 1000,
      updatedAtMs: 2000
    };
    currentRoom.jobs = [testJob];
    currentRoom.messages = [
      {
        messageId: "msg-mod-1",
        projectId: currentProject.projectId,
        kind: "role.say",
        authorMemberId: dev.memberId,
        authorLabel: "Developer",
        body: "I updated the header component and styles.",
        thinking: undefined,
        images: undefined,
        quoteIds: [],
        quotes: [],
        mentionRoleIds: [],
        jobId: "job-files-1",
        streaming: false,
        createdAtMs: 2000
      }
    ];

    const api = renderIm();
    (api.imGetRoom as ReturnType<typeof vi.fn>).mockResolvedValue(currentRoom);

    await act(async () => {
      window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "im" }));
    });

    expect(await screen.findByText("Modified 2 files")).toBeTruthy();
    expect(screen.getByText("src/components/Header.tsx")).toBeTruthy();
    expect(screen.getByText("src/styles.css")).toBeTruthy();

    const revealButtons = screen.getAllByRole("button", { name: "Reveal in Finder" });
    expect(revealButtons.length).toBeGreaterThan(0);
    fireEvent.click(revealButtons[0]!);
    expect(api.workbenchRevealPath).toHaveBeenCalledWith({
      rootPath: "/workspace/project",
      targetPath: "/workspace/project/src/components/Header.tsx"
    });

    const tabRequests: string[] = [];
    const diffs: Array<{ projectPath?: string; filePath?: string }> = [];
    const onTab = (event: Event) => tabRequests.push((event as CustomEvent<string>).detail);
    const onDiff = (event: Event) => diffs.push((event as CustomEvent<{ projectPath?: string; filePath?: string }>).detail);
    window.addEventListener("agent-resume:tab-request", onTab);
    window.addEventListener("agent-resume:workbench-open-diff", onDiff);
    fireEvent.click(screen.getAllByRole("button", { name: "Reveal in Workbench" })[0]!);
    window.removeEventListener("agent-resume:tab-request", onTab);
    window.removeEventListener("agent-resume:workbench-open-diff", onDiff);
    expect(tabRequests).toEqual(["workbench"]);
    expect(diffs).toEqual([{
      projectPath: "/workspace/project",
      filePath: "/workspace/project/src/components/Header.tsx"
    }]);
  });

  it("disables project tools until a real folder is associated", async () => {
    const currentProject = project({ localPath: null });
    const api = renderIm();
    (api.imListProjects as ReturnType<typeof vi.fn>).mockResolvedValue([currentProject]);
    (api.imGetRoom as ReturnType<typeof vi.fn>).mockResolvedValue(roomFor(currentProject));

    await act(async () => {
      window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "im" }));
    });

    const explorer = await screen.findByRole("button", { name: "Explorer" });
    expect(explorer).toHaveProperty("disabled", true);
    expect(screen.queryByRole("button", { name: "Scripts" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Search" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Git" })).toBeNull();
  });

  it("opens the Explorer pane for an associated project folder", async () => {
    const api = renderIm();
    await act(async () => {
      window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "im" }));
    });

    const explorer = await screen.findByRole("button", { name: "Explorer" });
    expect(explorer).toHaveProperty("disabled", false);
    fireEvent.click(explorer);
    expect(await screen.findByText("package.json")).toBeTruthy();
    expect(document.querySelector(".im-project-tools-panel")).not.toBeNull();
    expect(api.workbenchListDirectory).toHaveBeenCalled();
  });

  it("renders interactive delegation proposals on messages and handles approve/dismiss", async () => {
    const currentProject = project();
    const currentRoom = roomFor(currentProject);
    const arch = currentRoom.members.find((m) => m.templateId === "role_architect")!;
    currentRoom.messages = [
      {
        messageId: "msg-prop-test",
        projectId: currentProject.projectId,
        kind: "role.say",
        authorMemberId: arch.memberId,
        authorLabel: "Architect",
        body: `I have designed the microservices architecture.
<im_dispatch target="role_developer" reason="Implementation required">
Build the user service endpoints.
</im_dispatch>`,
        delegationProposals: [
          {
            id: "prop-unit-1",
            targetTemplateId: "role_developer",
            targetRoleName: "Developer",
            instruction: "Build the user service endpoints.",
            reason: "Implementation required",
            status: "pending",
            createdAtMs: 1000
          }
        ],
        quoteIds: [],
        quotes: [],
        mentionRoleIds: [],
        jobId: "j-arch-1",
        createdAtMs: 1000
      }
    ];

    const api = renderIm();
    (api.imGetRoom as ReturnType<typeof vi.fn>).mockResolvedValue(currentRoom);

    await act(async () => {
      window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "im" }));
    });

    expect(await screen.findByText("Proposed delegation to Developer")).toBeTruthy();
    expect(screen.getByText("Implementation required")).toBeTruthy();
    expect(screen.getByText("Build the user service endpoints.")).toBeTruthy();
    expect(screen.getByText("Pending review")).toBeTruthy();

    const approveBtn = screen.getByRole("button", { name: "Approve & Dispatch" });
    fireEvent.click(approveBtn);
    expect(api.imDispatchProposal).toHaveBeenCalledWith({
      projectId: currentProject.projectId,
      messageId: "msg-prop-test",
      proposalId: "prop-unit-1"
    });

    const dismissBtn = screen.getByRole("button", { name: "Dismiss" });
    fireEvent.click(dismissBtn);
    expect(api.imDismissProposal).toHaveBeenCalledWith({
      projectId: currentProject.projectId,
      messageId: "msg-prop-test",
      proposalId: "prop-unit-1"
    });
  });

  it("offers continue on interrupted dispatched jobs and saved drafts", async () => {
    const currentProject = project();
    const currentRoom = roomFor(currentProject);
    const arch = currentRoom.members.find((m) => m.templateId === "role_architect")!;
    const developer = currentRoom.members.find((m) => m.templateId === "role_developer")!;
    currentRoom.messages = [
      {
        messageId: "msg-prop-interrupted",
        projectId: currentProject.projectId,
        kind: "role.say",
        authorMemberId: arch.memberId,
        authorLabel: "Architect",
        body: "Design finished.",
        delegationProposals: [
          {
            id: "prop-interrupted-1",
            targetTemplateId: "role_developer",
            targetRoleName: "Developer",
            instruction: "Implement the plan.",
            status: "dispatched",
            dispatchedJobId: "job-dev-interrupted",
            createdAtMs: 1000
          }
        ],
        quoteIds: [],
        quotes: [],
        mentionRoleIds: [],
        jobId: "job-arch-1",
        createdAtMs: 1000
      },
      {
        messageId: "msg-dev-draft",
        projectId: currentProject.projectId,
        kind: "role.say",
        authorMemberId: developer.memberId,
        authorLabel: "Developer",
        body: "I started implementing auth.",
        quoteIds: [],
        quotes: [],
        mentionRoleIds: [],
        jobId: "job-dev-interrupted",
        createdAtMs: 1100
      }
    ];
    currentRoom.jobs = [
      {
        jobId: "job-dev-interrupted",
        projectId: currentProject.projectId,
        memberId: developer.memberId,
        messageId: null,
        acpChatId: "chat-1",
        status: "cancelled",
        brief: { persona: "", instruction: "Implement the plan.", cwd: "/tmp", quotes: [], knowledge: [] },
        error: "App restarted while job was running",
        filesChanged: [],
        permission: null,
        createdAtMs: 1050,
        updatedAtMs: 1200,
        finishedAtMs: 1200
      }
    ];

    const api = renderIm();
    (api.imGetRoom as ReturnType<typeof vi.fn>).mockResolvedValue(currentRoom);
    await act(async () => {
      window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "im" }));
    });

    expect(await screen.findByText("Interrupted before finishing. Saved draft is kept.")).toBeTruthy();
    const continueButtons = screen.getAllByRole("button", { name: "Continue" });
    expect(continueButtons.length).toBeGreaterThan(0);
    fireEvent.click(continueButtons[0]!);
    expect(api.imResumeJob).toHaveBeenCalledWith({ jobId: "job-dev-interrupted" });
  });

  it("renders auto-routed badge and routing tips (unmatched and timeout)", async () => {
    const currentProject = project();
    const currentRoom = roomFor(currentProject);
    currentRoom.messages = [
      {
        messageId: "msg-routed",
        projectId: currentProject.projectId,
        kind: "human",
        authorMemberId: null,
        authorLabel: "You",
        body: "Can you fix the login issue?",
        autoRouted: true,
        routedRoleName: "Developer",
        quoteIds: [],
        quotes: [],
        mentionRoleIds: [],
        jobId: "j-dev",
        createdAtMs: 1000
      },
      {
        messageId: "msg-tip-unmatched",
        projectId: currentProject.projectId,
        kind: "human",
        authorMemberId: null,
        authorLabel: "You",
        body: "Hello there",
        routingTip: "desktop.im.routingUnmatchedTip",
        routingTimedOut: false,
        quoteIds: [],
        quotes: [],
        mentionRoleIds: [],
        jobId: null,
        createdAtMs: 2000
      },
      {
        messageId: "msg-tip-timeout",
        projectId: currentProject.projectId,
        kind: "human",
        authorMemberId: null,
        authorLabel: "You",
        body: "Analyze complex cross-cutting system concern",
        routingTip: "desktop.im.routingTimeoutTip",
        routingTimedOut: true,
        quoteIds: [],
        quotes: [],
        mentionRoleIds: [],
        jobId: null,
        createdAtMs: 3000
      }
    ];

    const api = renderIm();
    (api.imGetRoom as ReturnType<typeof vi.fn>).mockResolvedValue(currentRoom);

    await act(async () => {
      window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "im" }));
    });

    expect(await screen.findByText("Auto-assigned to @Developer")).toBeTruthy();
    expect(screen.getByText("No matching role identified. You can use @ in the composer to assign a task.")).toBeTruthy();
    expect(screen.getByText("Intent analysis timed out (30s). You can use @ in the composer to manually assign a role.")).toBeTruthy();
    expect(document.querySelector(".im-routing-tip.is-timeout")).not.toBeNull();
    expect(document.querySelector(".im-routing-tip.is-unmatched")).not.toBeNull();
  });

  it("adds Ask again on completed agent replies and sends a follow-up on the same role", async () => {
    const api = renderIm();
    const next = roomFor(project());
    (api.imGetRoom as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...next,
      messages: [
        {
          messageId: "msg-user",
          projectId: "proj-1",
          kind: "human",
          authorMemberId: null,
          authorLabel: "You",
          body: "plan this",
          quoteIds: [],
          quotes: [],
          mentionRoleIds: ["mem-pm"],
          jobId: "job-1",
          threadId: "thread-1",
          createdAtMs: 1
        },
        {
          messageId: "msg-agent",
          projectId: "proj-1",
          kind: "role.say",
          authorMemberId: "mem-pm",
          authorLabel: "Product Manager",
          body: "Here is the plan",
          quoteIds: [],
          quotes: [],
          mentionRoleIds: [],
          jobId: "job-1",
          threadId: "thread-1",
          createdAtMs: 2
        }
      ],
      jobs: [{
        jobId: "job-1",
        projectId: "proj-1",
        memberId: "mem-pm",
        messageId: "msg-user",
        brief: { persona: "", instruction: "plan this", cwd: "/tmp", quotes: [], knowledge: [] },
        status: "completed" as const,
        filesChanged: [],
        error: null,
        acpChatId: "chat-1",
        permission: null,
        finishedAtMs: 2,
        createdAtMs: 1,
        updatedAtMs: 2,
        threadId: "thread-1"
      }]
    });
    await act(async () => {
      window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "im" }));
    });
    expect(screen.queryAllByRole("button", { name: "Ask again" })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Ask again" }));
    expect(await screen.findByLabelText("Stop continuing this reply")).toBeTruthy();
    const composer = screen.getByLabelText("Message the room. @ a role. Enter to send, Shift+Enter for a new line.");
    fireEvent.change(composer, { target: { value: "add more detail" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(api.imPostMessage).toHaveBeenCalledWith(expect.objectContaining({
      body: "add more detail",
      mentionRoleIds: ["mem-pm"],
      followUpToMessageId: "msg-agent",
      quoteIds: []
    })));
  });

  it("does not show Ask again on interrupted replies that still have Resume", async () => {
    const currentProject = project();
    const currentRoom = roomFor(currentProject);
    const developer = currentRoom.members.find((m) => m.templateId === "role_developer")!;
    currentRoom.messages = [{
      messageId: "msg-dev-draft",
      projectId: currentProject.projectId,
      kind: "role.say",
      authorMemberId: developer.memberId,
      authorLabel: "Developer",
      body: "Step 1 is done.",
      quoteIds: [],
      quotes: [],
      mentionRoleIds: [],
      jobId: "job-dev-interrupted",
      createdAtMs: 1100
    }];
    currentRoom.jobs = [{
      jobId: "job-dev-interrupted",
      projectId: currentProject.projectId,
      memberId: developer.memberId,
      messageId: null,
      acpChatId: "chat-1",
      status: "cancelled",
      brief: { persona: "", instruction: "Implement the plan.", cwd: "/tmp", quotes: [], knowledge: [] },
      error: "App restarted while job was running",
      filesChanged: [],
      permission: null,
      createdAtMs: 1050,
      updatedAtMs: 1200,
      finishedAtMs: 1200
    }];
    const api = renderIm();
    (api.imGetRoom as ReturnType<typeof vi.fn>).mockResolvedValue(currentRoom);
    await act(async () => {
      window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "im" }));
    });
    expect(await screen.findByText("Interrupted before finishing. Saved draft is kept.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Ask again" })).toBeNull();
    expect(screen.getAllByRole("button", { name: "Continue" }).length).toBeGreaterThan(0);
  });

  it("opens the tools popover in composer and displays tool mode options", async () => {
    const currentProject = project();
    const currentRoom = roomFor(currentProject);
    const api = renderIm();
    (api.imGetRoom as ReturnType<typeof vi.fn>).mockResolvedValue(currentRoom);
    (api.listAgentTools as ReturnType<typeof vi.fn>).mockResolvedValue([
      { name: "note_list", description: "List notes", category: "notes" },
      { name: "skill:dividend-cows", description: "Dividend stocks", category: "skills", kind: "skill" }
    ]);

    await act(async () => {
      window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "im" }));
    });

    const toolsBtn = await screen.findByRole("button", { name: "Tools toggle" });
    expect(toolsBtn).toBeTruthy();

    await act(async () => {
      fireEvent.click(toolsBtn);
    });

    expect(await screen.findByRole("dialog", { name: "Tools" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Auto" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Custom" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Off" })).toBeTruthy();
  });
});
