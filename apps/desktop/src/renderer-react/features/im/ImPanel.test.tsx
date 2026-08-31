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
  "desktop.im.toggleDetails": "Roles & Background",
  "desktop.im.selectChat": "Select or create a chat.",
  "desktop.im.configRole": "Configure role",
  "desktop.im.roleAgent": "Agent",
  "desktop.im.roleModel": "Model",
  "desktop.im.defaultModel": "Default (Follow template)",
  "desktop.im.resetDefault": "Reset to default",
  "desktop.im.fetchModels": "Fetch models",
  "desktop.im.customBadge": "Custom",
  "desktop.common.revealInFinder": "Reveal in Finder",
  "desktop.im.emptyRoom": "Quote a message and @ a role to dispatch work.",
  "desktop.im.transcript": "Room transcript",
  "desktop.im.mentions": "Mentioned roles",
  "desktop.im.quote": "Quote",
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
  "desktop.common.showSidebar": "Show sidebar",
  "desktop.common.hideSidebar": "Hide sidebar",
  "desktop.common.confirm": "Confirm",
  "desktop.common.cancel": "Cancel",
  "desktop.common.send": "Send",
  "desktop.im.role.developer": "Developer",
  "desktop.im.role.productManager": "Product Manager",
  "desktop.im.role.projectManager": "Project Manager",
  "desktop.im.role.uiDesigner": "UI Designer",
  "desktop.im.role.tester": "Tester",
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
    imDeleteProject: vi.fn(async () => ({ ok: true })),
    imGetRoom: vi.fn(async () => roomFor(created)),
    imPickLocalPath: vi.fn(async () => ({ ok: true as const, path: "/tmp/app" })),
    imSetLocalPath: vi.fn(async ({ projectId, localPath }: { projectId: string; localPath: string | null }) => project({ projectId, localPath })),
    revealProjectInFinder: vi.fn(async () => ({ ok: true, path: created.localPath })),
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
    imResetMemberOverrides: vi.fn(async ({ memberId }: { memberId: string }) => {
      const mem = roomFor(created).members.find((m) => m.memberId === memberId) || roomFor(created).members[0]!;
      return { ...mem, agent: "claude", model: undefined };
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
    expect(screen.getByText("Project Manager")).toBeTruthy();
    expect(screen.getByText("UI Designer")).toBeTruthy();
    expect(screen.getByText("Developer")).toBeTruthy();
    expect(screen.getByText("Tester")).toBeTruthy();
    expect(screen.getAllByRole("checkbox")).toHaveLength(5);
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
      expect(screen.getByRole("option", { name: /Project Manager/ }).getAttribute("aria-selected")).toBe("true");
    });
    expect(list.querySelector(".active")?.textContent).toMatch(/Project Manager/);
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

    // Hover to trigger preview popover
    fireEvent.mouseEnter(nodes[1]!);
    expect(document.querySelector(".im-timeline-popover")).not.toBeNull();
    expect(document.querySelector(".im-timeline-popover-author")?.textContent).toBe("Product Manager");
    expect(document.querySelector(".im-timeline-popover-snippet")?.textContent).toBe("Second message");

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

  it("opens a chat context menu with rename and associate folder actions", async () => {
    const api = renderIm();
    await act(async () => {
      window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "im" }));
    });
    const row = await screen.findByRole("button", { name: /Room One/ });
    fireEvent.contextMenu(row);
    expect(await screen.findByRole("menuitem", { name: "Rename" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Associate folder" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Reveal in Finder" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Delete chat" })).toBeTruthy();

    fireEvent.click(screen.getByRole("menuitem", { name: "Associate folder" }));
    await waitFor(() => expect(api.imPickLocalPath).toHaveBeenCalled());
    await waitFor(() => expect(api.imSetLocalPath).toHaveBeenCalledWith({
      projectId: "proj-1",
      localPath: "/tmp/app"
    }));
  });

  it("starts a new chat from Cmd+T shortcut and IPC event", async () => {
    renderIm();
    await act(async () => {
      window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "im" }));
    });
    expect(await screen.findByRole("button", { name: /New chat/ })).toBeTruthy();
    
    // Trigger via IPC event emitted on Electron before-input-event
    await act(async () => {
      window.dispatchEvent(new CustomEvent("test:cmd-t"));
    });
    expect(await screen.findByLabelText("Chat name")).toBeTruthy();
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
  });
});
