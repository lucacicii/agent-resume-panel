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
  "desktop.im.quote": "Quote",
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
    const quote = await screen.findByRole("button", { name: "Quote" });
    fireEvent.click(quote);
    await waitFor(() => expect(screen.getByLabelText("Remove quote")).toBeTruthy());
  });
});
