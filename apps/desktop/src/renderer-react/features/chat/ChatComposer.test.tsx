import React from "react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { ChatComposer, compileChatPrompt } from "./ChatComposer";
import type { SkillDescriptor, AgentToolDescriptor } from "@agent-resume/core";

describe("compileChatPrompt", () => {
  beforeEach(() => {
    (window as any).agentResume = {
      readSkill: vi.fn().mockResolvedValue("Instructions for browser-use skill"),
      notesRead: vi.fn().mockImplementation(async ({ noteId }: { noteId: string }) => {
        if (noteId === "note-1") {
          return {
            record: { noteId: "note-1", title: "Architecture Doc" },
            content: "Architecture details: microservices and event buses."
          };
        }
        if (noteId === "task-1") {
          return {
            record: { noteId: "task-1", title: "Migrate database" },
            content: "Step 1: create migration scripts\nStep 2: apply in staging"
          };
        }
        return null;
      }),
      thunderChatGetConversation: vi.fn().mockResolvedValue({
        id: "sess-1",
        title: "Previous Discussion",
        messages: [
          { role: "user", content: "How does caching work?" },
          { role: "assistant", content: "It uses Redis TTLs." }
        ]
      }),
      workbenchReadFileText: vi.fn().mockImplementation(async ({ filePath }: { filePath: string }) => {
        if (filePath === "src/index.ts") {
          return {
            content: "export const app = 'test';",
            truncated: false,
            byteLength: 28
          };
        }
        return null;
      })
    };
  });

  it("resolves skill slash command and injects skill instructions", async () => {
    const skills: SkillDescriptor[] = [
      {
        name: "browser-use",
        description: "Direct browser control via CDP",
        location: "/path/to/SKILL.md",
        directory: "/path/to",
        scope: "user"
      }
    ];

    const result = await compileChatPrompt("/browser-use search github for agent-resume", {
      workspaceDir: "/work/repo",
      skills
    });

    expect((window as any).agentResume.readSkill).toHaveBeenCalledWith({ location: "/path/to/SKILL.md" });
    expect(result).toContain("[Active Skill Instructions: browser-use]");
    expect(result).toContain("Instructions for browser-use skill");
    expect(result).toContain("search github for agent-resume");
  });

  it("resolves MCP tool slash command and injects tool block", async () => {
    const tools: AgentToolDescriptor[] = [
      {
        name: "bash",
        description: "Execute bash commands in working directory",
        category: "workbench",
        kind: "core_mcp"
      }
    ];

    const result = await compileChatPrompt("/bash ls -la", {
      workspaceDir: "/work/repo",
      tools
    });

    expect(result).toContain("[Requested MCP Tool: bash]");
    expect(result).toContain("Execute bash commands in working directory");
    expect(result).toContain("ls -la");
  });

  it("resolves referenced note, task, and session mentions (@)", async () => {
    const result = await compileChatPrompt("Please review these resources", {
      workspaceDir: "/work/repo",
      referencedMentions: [
        { kind: "note", id: "note-1", title: "Architecture Doc", badge: "笔记" },
        { kind: "task", id: "task-1", title: "Migrate database", badge: "任务", gtdStatus: "next" },
        { kind: "session", id: "sess-1", title: "Previous Discussion", badge: "会话" }
      ]
    });

    expect(result).toContain("[Referenced Note: Architecture Doc]");
    expect(result).toContain("Architecture details: microservices and event buses.");

    expect(result).toContain("[Referenced GTD Task: Migrate database (Status: 进行中)]");
    expect(result).toContain("Step 1: create migration scripts");

    expect(result).toContain("[Referenced Conversation: Previous Discussion]");
    expect(result).toContain("user: How does caching work?");
    expect(result).toContain("assistant: It uses Redis TTLs.");
    expect(result).toContain("Please review these resources");
  });

  it("resolves referenced file (#) and reads its text content", async () => {
    const result = await compileChatPrompt("Check this file #src/index.ts", {
      workspaceDir: "/work/repo",
      referencedFiles: ["src/index.ts"]
    });

    expect((window as any).agentResume.workbenchReadFileText).toHaveBeenCalledWith({
      rootPath: "/work/repo",
      filePath: "src/index.ts",
      maxBytes: 64 * 1024
    });
    expect(result).toContain("[Referenced File: src/index.ts]");
    expect(result).toContain("export const app = 'test';");
    expect(result).toContain("Check this file #src/index.ts");
  });
});

describe("ChatComposer UI popovers and keyboard interactions", () => {
  const defaultProps = {
    onSend: vi.fn(),
    onCancel: vi.fn(),
    isStreaming: false,
    models: [{ id: "mock-1", name: "Mock Model", selection_id: "mock-1", provider: "mock", available: true }],
    selectedModel: "mock-1",
    onSelectModel: vi.fn(),
    thinkingLevel: "off",
    onSelectThinkingLevel: vi.fn(),
    workspaceDir: "/test/workspace",
    onSelectWorkspaceDir: vi.fn(),
    useMock: false,
    onToggleMock: vi.fn()
  };

  beforeEach(() => {
    (window as any).agentResume = {
      listSkills: vi.fn().mockResolvedValue([
        {
          name: "dividend-cows",
          description: "High dividend stock screener",
          location: "/skills/dividend-cows/SKILL.md",
          directory: "/skills/dividend-cows",
          scope: "user"
        }
      ]),
      listAgentTools: vi.fn().mockResolvedValue([
        {
          name: "bash",
          description: "Execute shell command",
          category: "workbench",
          kind: "core_mcp"
        }
      ]),
      notesList: vi.fn().mockResolvedValue([
        { noteId: "note-abc", title: "Project Plan", relDir: "docs" }
      ]),
      notesListTasks: vi.fn().mockResolvedValue([
        { noteId: "task-xyz", title: "Refactor router", gtdStatus: "next", updatedAtMs: Date.now() }
      ]),
      thunderChatListConversations: vi.fn().mockResolvedValue([
        { id: "conv-123", title: "Design Review", message_count: 5 }
      ]),
      workbenchListDirectory: vi.fn().mockResolvedValue({
        entries: [
          { name: "src", isDirectory: true },
          { name: "package.json", isDirectory: false }
        ]
      }),
      readSkill: vi.fn().mockResolvedValue("Skill content"),
      notesRead: vi.fn().mockResolvedValue({
        record: { noteId: "note-abc", title: "Project Plan" },
        content: "Detailed project plan contents."
      }),
      workbenchReadFileText: vi.fn().mockResolvedValue({
        content: "{\n  \"name\": \"app\"\n}",
        truncated: false,
        byteLength: 20
      })
    };
  });

  afterEach(() => {
    cleanup();
  });

  it("displays slash suggestions when typing / and accepts selection with Tab", async () => {
    render(<ChatComposer {...defaultProps} />);
    const textarea = screen.getByPlaceholderText(/Ask Thunder agent anything/i);

    // Type "/" to open slash popover
    fireEvent.change(textarea, { target: { value: "/", selectionStart: 1 } });

    await waitFor(() => {
      expect(screen.getByRole("listbox", { name: /slash commands/i })).toBeTruthy();
      expect(screen.getByText("/dividend-cows")).toBeTruthy();
    });

    // Press Tab to accept the first slash command
    fireEvent.keyDown(textarea, { key: "Tab" });

    await waitFor(() => {
      expect((textarea as HTMLTextAreaElement).value).toBe("/dividend-cows ");
    });
  });

  it("displays mention suggestions when typing @ and accepts selection with Enter", async () => {
    render(<ChatComposer {...defaultProps} />);
    const textarea = screen.getByPlaceholderText(/Ask Thunder agent anything/i);

    // Type "@" to open mention popover
    fireEvent.change(textarea, { target: { value: "@", selectionStart: 1 } });

    await waitFor(() => {
      expect(screen.getByRole("listbox", { name: /mention context/i })).toBeTruthy();
      expect(screen.getByText("@Refactor router")).toBeTruthy();
      expect(screen.getByText("@Project Plan")).toBeTruthy();
    });

    // Press Enter to accept first mention
    fireEvent.keyDown(textarea, { key: "Enter" });

    await waitFor(() => {
      expect((textarea as HTMLTextAreaElement).value).toBe("@Refactor router ");
    });
  });

  it("displays file/directory suggestions when typing # and navigates with ArrowRight", async () => {
    render(<ChatComposer {...defaultProps} />);
    const textarea = screen.getByPlaceholderText(/Ask Thunder agent anything/i);

    // Type "#" to open file/directory popover
    fireEvent.change(textarea, { target: { value: "#", selectionStart: 1 } });

    await waitFor(() => {
      expect(screen.getByRole("listbox", { name: /files and directories/i })).toBeTruthy();
      expect(screen.getByText("#src/")).toBeTruthy();
      expect(screen.getByText("#package.json")).toBeTruthy();
    });

    // Press ArrowRight on "src" directory to enter directory drilldown
    fireEvent.keyDown(textarea, { key: "ArrowRight" });

    await waitFor(() => {
      expect((textarea as HTMLTextAreaElement).value).toBe("#src/");
    });
  });

  it("compiles prompt and calls onSend with context when Enter is pressed", async () => {
    const onSend = vi.fn();
    render(<ChatComposer {...defaultProps} onSend={onSend} />);
    const textarea = screen.getByPlaceholderText(/Ask Thunder agent anything/i);

    // Type mention "@Project Plan"
    fireEvent.change(textarea, { target: { value: "@", selectionStart: 1 } });

    await waitFor(() => {
      expect(screen.getByText("@Project Plan")).toBeTruthy();
    });

    // Click on "@Project Plan"
    fireEvent.click(screen.getByText("@Project Plan"));

    await waitFor(() => {
      expect((textarea as HTMLTextAreaElement).value).toBe("@Project Plan ");
    });

    // Add prompt text and submit
    fireEvent.change(textarea, {
      target: { value: "@Project Plan please review this plan", selectionStart: 38 }
    });
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false });

    await waitFor(() => {
      expect(onSend).toHaveBeenCalledWith(
        expect.stringContaining("[Referenced Note: Project Plan]"),
        expect.anything()
      );
      expect(onSend).toHaveBeenCalledWith(
        expect.stringContaining("Detailed project plan contents."),
        expect.anything()
      );
    });
  });
});
