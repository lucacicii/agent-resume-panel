import { describe, expect, it } from "vitest";
import { excludeCodexAcpNativeSessions, isAcpAgentSession, mergeCatalogAndAcpSessions } from "./sessionList";
import type { AgentSession } from "@agent-resume/core";
import type { AcpSessionRecord } from "./types";

describe("mergeCatalogAndAcpSessions", () => {
  it("merges acp store sessions into catalog list", () => {
    const catalog: AgentSession[] = [
      {
        provider: "codex",
        id: "cli-1",
        title: "CLI",
        projectPath: "/p",
        updatedAt: 100
      }
    ];
    const acp: AgentSession[] = [
      {
        provider: "chat",
        id: "acp-1",
        title: "ACP chat",
        projectPath: "/p",
        updatedAt: 200,
        source: "acp",
        acpProvider: "claude"
      }
    ];
    const merged = mergeCatalogAndAcpSessions(catalog, acp, 50);
    expect(merged).toHaveLength(2);
    expect(merged[0]?.id).toBe("acp-1");
    expect(merged[0]?.acpProvider).toBe("claude");
  });

  it("prefers fresher updatedAt on id collision", () => {
    const catalog: AgentSession[] = [
      {
        provider: "chat",
        id: "same",
        title: "Old",
        projectPath: "/p",
        updatedAt: 10,
        acpProvider: "codex"
      }
    ];
    const acp: AgentSession[] = [
      {
        provider: "chat",
        id: "same",
        title: "New",
        projectPath: "/p",
        updatedAt: 99,
        source: "acp",
        acpProvider: "claude"
      }
    ];
    const merged = mergeCatalogAndAcpSessions(catalog, acp, 10);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.title).toBe("New");
    expect(merged[0]?.acpProvider).toBe("claude");
  });

  it("returns every merged session when no display limit is provided", () => {
    const catalog = Array.from({ length: 600 }, (_, index): AgentSession => ({
      provider: "codex",
      id: `cli-${index}`,
      title: `CLI ${index}`,
      projectPath: "/p",
      updatedAt: index
    }));
    const acp = Array.from({ length: 50 }, (_, index): AgentSession => ({
      provider: "chat",
      id: `acp-${index}`,
      title: `ACP ${index}`,
      projectPath: "/p",
      updatedAt: 1_000 + index,
      source: "acp"
    }));

    const merged = mergeCatalogAndAcpSessions(catalog, acp);
    expect(merged).toHaveLength(650);
    expect(merged[0]?.id).toBe("acp-49");
  });
});

describe("isAcpAgentSession", () => {
  it("only treats provider chat as ACP (never CLI providers)", () => {
    expect(isAcpAgentSession({ provider: "chat", source: undefined, acpProvider: undefined })).toBe(true);
    expect(isAcpAgentSession({ provider: "chat", source: "acp", acpProvider: "claude" })).toBe(true);
    // CLI must not be hijacked even with misleading source/acpProvider
    expect(isAcpAgentSession({ provider: "codex", source: "acp", acpProvider: undefined })).toBe(false);
    expect(isAcpAgentSession({ provider: "codex", source: undefined, acpProvider: "claude" })).toBe(false);
    expect(isAcpAgentSession({ provider: "grok", source: "summary", acpProvider: undefined })).toBe(false);
  });
});

describe("excludeCodexAcpNativeSessions", () => {
  it("removes only the Codex native row claimed by an ACP record", () => {
    const catalog: AgentSession[] = [
      { provider: "codex", id: "native-acp", title: "Duplicate", projectPath: "/p", updatedAt: 3, source: "vscode" },
      { provider: "codex", id: "normal-vscode", title: "Normal", projectPath: "/p", updatedAt: 2, source: "vscode" },
      { provider: "grok", id: "native-acp", title: "Other provider", projectPath: "/p", updatedAt: 1 }
    ];
    const records: AcpSessionRecord[] = [{
      id: "chat-1",
      title: "ACP",
      projectPath: "/p",
      provider: "codex",
      acpSessionId: "native-acp",
      createdAt: 1,
      updatedAt: 3,
      messageCount: 1
    }];

    expect(excludeCodexAcpNativeSessions(catalog, records).map((session) => `${session.provider}:${session.id}`))
      .toEqual(["codex:normal-vscode", "grok:native-acp"]);
  });
});
