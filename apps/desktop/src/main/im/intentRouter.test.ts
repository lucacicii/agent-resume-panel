import { describe, expect, it, vi } from "vitest";
import type { ImMember } from "../../shared/imTypes";
import { buildRolesRoutingPrompt, parseIntentClassification, routeMessageIntent } from "./intentRouter";

const mockMembers: ImMember[] = [
  {
    memberId: "mem-pm",
    projectId: "p1",
    templateId: "role_product_manager",
    name: "Product Manager",
    persona: "Clarify requirements and write PRD.",
    agent: "claude",
    permissions: "read",
    tools: { fsRead: true, fsWrite: false, execute: false },
    enabled: true,
    acpChatId: null,
    createdAtMs: 1,
    updatedAtMs: 1
  },
  {
    memberId: "mem-arch",
    projectId: "p1",
    templateId: "role_architect",
    name: "Architect",
    persona: "Plan system architecture and module designs.",
    agent: "claude",
    permissions: "read",
    tools: { fsRead: true, fsWrite: false, execute: false },
    enabled: true,
    acpChatId: null,
    createdAtMs: 1,
    updatedAtMs: 1
  },
  {
    memberId: "mem-dev",
    projectId: "p1",
    templateId: "role_developer",
    name: "Developer",
    persona: "Implement code in the working directory.",
    agent: "claude",
    permissions: "write",
    tools: { fsRead: true, fsWrite: true, execute: true },
    enabled: true,
    acpChatId: null,
    createdAtMs: 1,
    updatedAtMs: 1
  }
];

const memoryMember: ImMember = {
  memberId: "mem-mem",
  projectId: "p1",
  templateId: "role_memory",
  name: "Memory Specialist",
  persona: "Memory & Knowledge Specialist. Maintain project notes, digests, and past sessions.",
  agent: "claude",
  permissions: "read",
  tools: { fsRead: true, fsWrite: false, execute: false },
  enabled: true,
  acpChatId: null,
  createdAtMs: 1,
  updatedAtMs: 1
};

const mockMembersWithMemory: ImMember[] = [...mockMembers, memoryMember];

describe("intentRouter", () => {
  describe("parseIntentClassification", () => {
    it("parses valid JSON matching templateId", () => {
      const raw = JSON.stringify({
        matched: true,
        targetId: "role_developer",
        targetName: "Developer",
        reason: "User wants code implemented"
      });
      const result = parseIntentClassification(raw, mockMembers);
      expect(result.matched).toBe(true);
      expect(result.targetMember?.memberId).toBe("mem-dev");
      expect(result.reason).toBe("User wants code implemented");
    });

    it("parses JSON wrapped in markdown code blocks", () => {
      const raw = `\`\`\`json
{
  "matched": true,
  "targetId": "role_architect",
  "targetName": "Architect",
  "reason": "Need architecture diagram"
}
\`\`\``;
      const result = parseIntentClassification(raw, mockMembers);
      expect(result.matched).toBe(true);
      expect(result.targetMember?.memberId).toBe("mem-arch");
    });

    it("matches by role name or alias if targetId is imprecise", () => {
      const raw = JSON.stringify({
        matched: true,
        targetId: "developer",
        targetName: "Developer",
        reason: "Coding task"
      });
      const result = parseIntentClassification(raw, mockMembers);
      expect(result.matched).toBe(true);
      expect(result.targetMember?.memberId).toBe("mem-dev");
    });

    it("returns matched: false when model indicates no match", () => {
      const raw = JSON.stringify({
        matched: false,
        reason: "General discussion"
      });
      const result = parseIntentClassification(raw, mockMembers);
      expect(result.matched).toBe(false);
      expect(result.targetMember).toBeUndefined();
    });

    it("matches memory role when targetName echoes the persona wording", () => {
      const raw = JSON.stringify({
        matched: true,
        targetId: "memory_specialist",
        targetName: "Memory & Knowledge Specialist",
        reason: "Notes question"
      });
      const result = parseIntentClassification(raw, mockMembersWithMemory);
      expect(result.matched).toBe(true);
      expect(result.targetMember?.memberId).toBe("mem-mem");
    });

    it("matches note-related ids to the memory role", () => {
      const raw = JSON.stringify({
        matched: true,
        targetId: "notes",
        targetName: "",
        reason: "Note taking"
      });
      const result = parseIntentClassification(raw, mockMembersWithMemory);
      expect(result.matched).toBe(true);
      expect(result.targetMember?.templateId).toBe("role_memory");
    });
  });

  describe("buildRolesRoutingPrompt", () => {
    it("appends builtin responsibility hints with note keywords", () => {
      const prompt = buildRolesRoutingPrompt(mockMembersWithMemory);
      const memoryLine = prompt.split("\n").find((line) => line.includes("role_memory"))!;
      expect(memoryLine).toContain("笔记");
      expect(memoryLine).toContain("knowledge base");
    });

    it("keeps custom-role lines persona-only", () => {
      const custom: ImMember = {
        ...mockMembers[0],
        memberId: "mem-custom",
        templateId: "custom_role",
        name: "Custom Role"
      };
      const prompt = buildRolesRoutingPrompt([custom]);
      expect(prompt).not.toContain("Responsibilities include");
      expect(prompt).toContain("Clarify requirements");
    });
  });

  describe("routeMessageIntent", () => {
    it("fast paths short messages without calling LLM", async () => {
      const result = await routeMessageIntent({
        text: "好的",
        roomMembers: mockMembers,
        settings: {} as any,
        desktopDb: "/tmp/db.sqlite"
      });
      expect(result.matched).toBe(false);
      expect(result.timedOut).toBe(false);
      expect(result.tip).toBe("desktop.im.routingUnmatchedTip");
    });

    it("returns unmatched tip when no LLM is configured", async () => {
      const result = await routeMessageIntent({
        text: "Please implement user authentication with JWT tokens",
        roomMembers: mockMembers,
        settings: {} as any,
        desktopDb: "/tmp/db.sqlite"
      });
      expect(result.matched).toBe(false);
      expect(result.timedOut).toBe(false);
      expect(result.tip).toBe("desktop.im.routingUnmatchedTip");
    });

    it("handles timeout correctly and returns timedOut: true with timeout tip", async () => {
      const settings = {
        providers: [
          {
            id: "openai",
            name: "OpenAI",
            baseUrl: "https://api.openai.com/v1",
            apiKey: "sk-test",
            models: [{ id: "gpt-4o", label: "GPT-4o", kind: "text" as const }]
          }
        ],
        modelSelections: {
          chat: { providerId: "openai", modelId: "gpt-4o" }
        }
      };

      // Mock fetch with a hanging promise to trigger timeout
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn((_url, options?: any) => {
        return new Promise((_resolve, reject) => {
          const onAbort = () => {
            const err = new DOMException("The operation was aborted", "AbortError");
            reject(err);
          };
          if (options?.signal?.aborted) {
            onAbort();
          } else if (options?.signal) {
            options.signal.addEventListener("abort", onAbort);
          }
        });
      }) as any;

      try {
        const result = await routeMessageIntent({
          text: "Can someone help implement the database migrations?",
          roomMembers: mockMembers,
          settings: settings as any,
          desktopDb: "/tmp/db.sqlite",
          timeoutMs: 50 // Short timeout for unit test
        });

        expect(result.matched).toBe(false);
        expect(result.timedOut).toBe(true);
        expect(result.tip).toBe("desktop.im.routingTimeoutTip");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });
});
