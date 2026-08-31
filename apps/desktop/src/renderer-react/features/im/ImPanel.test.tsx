import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { ImPanel } from "./ImPanel";
import type { ImProject, ImRoom } from "../../../shared/imTypes";

const messages = {
  "desktop.im.title": "IM",
  "desktop.im.projects": "Projects",
  "desktop.im.newProject": "New project",
  "desktop.im.projectName": "Project name",
  "desktop.im.noProjects": "No IM projects yet",
  "desktop.im.noFolder": "No folder",
  "desktop.im.associateFolder": "Associate folder",
  "desktop.im.associateFolderTitle": "Select folder",
  "desktop.im.needFolder": "Associate a local folder before asking a role to work.",
  "desktop.im.selectProject": "Select or create a project.",
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
    imCreateProject: vi.fn(async ({ name }: { name: string }) => project({ name })),
    imGetRoom: vi.fn(async () => roomFor(created)),
    imPickLocalPath: vi.fn(async () => ({ ok: true as const, path: "/tmp/app" })),
    imSetLocalPath: vi.fn(async () => created),
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
});
