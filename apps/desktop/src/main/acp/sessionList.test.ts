import { describe, expect, it } from "vitest";
import { isAcpAgentSession, mergeCatalogAndAcpSessions } from "./sessionList";
import type { AgentSession } from "@agent-resume/core";

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
