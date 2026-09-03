import { describe, expect, it } from "vitest";
import type { PanelSettings } from "@agent-resume/core";
import { resolveAgentModels } from "./agentModelResolver";

describe("agentModelResolver", () => {
  it("retrieves text models from all configured Desktop providers", async () => {
    const settings = {
      providers: [
        {
          id: "prov-openai",
          name: "OpenAI",
          baseUrl: "https://api.openai.com/v1",
          models: [
            { id: "gpt-4o", kind: "text" },
            { id: "o3-mini", kind: "text" },
            { id: "text-embedding-3-small", kind: "embedding" }
          ]
        },
        {
          id: "prov-anthropic",
          name: "Anthropic",
          baseUrl: "https://api.anthropic.com/v1",
          models: [
            { id: "claude-3-7-sonnet", kind: "text" }
          ]
        }
      ]
    } as unknown as PanelSettings;

    const models = await resolveAgentModels("claude", settings);
    const modelIds = models.map((m) => m.id);

    expect(modelIds).toEqual(["gpt-4o", "o3-mini", "claude-3-7-sonnet"]);
    expect(modelIds).not.toContain("text-embedding-3-small");

    const gpt = models.find((m) => m.id === "gpt-4o");
    expect(gpt?.label).toBe("gpt-4o (OpenAI)");
    expect(gpt?.provider).toBe("OpenAI");

    const claude = models.find((m) => m.id === "claude-3-7-sonnet");
    expect(claude?.label).toBe("claude-3-7-sonnet (Anthropic)");
    expect(claude?.provider).toBe("Anthropic");
  });

  it("falls back to curated models when no provider models are configured", async () => {
    const settings = {
      providers: []
    } as unknown as PanelSettings;

    const models = await resolveAgentModels("claude", settings);
    const modelIds = models.map((m) => m.id);

    expect(modelIds).toContain("claude-3-7-sonnet-20250219");
    expect(modelIds).toContain("claude-3-5-sonnet-20241022");
  });
});
