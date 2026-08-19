import { describe, expect, it } from "vitest";
import type { SessionMeta } from "../agentConnection";
import {
  GROK_MODEL_CONFIG_ID,
  GROK_REASONING_EFFORT_CONFIG_ID,
  GROK_SESSION_MODES,
  applyGrokVendorSessionMeta
} from "./grok";

const GROK_SESSION_NEW_FIXTURE: Record<string, unknown> = {
  sessionId: "019fa14f-5813-7fa0-9241-05324f18b5c0",
  models: {
    currentModelId: "grok-4.5",
    availableModels: [
      {
        modelId: "grok-4.5",
        name: "Grok 4.5",
        _meta: {
          supportsReasoningEffort: true,
          reasoningEffort: "medium",
          reasoningEfforts: [
            { id: "high", value: "high", label: "High Effort" },
            { id: "medium", value: "medium", label: "Medium Effort" },
            { id: "low", value: "low", label: "Low Effort" }
          ]
        }
      }
    ]
  },
  _meta: {
    "x.ai/sessionDetail": {
      sessionId: "019fa14f-5813-7fa0-9241-05324f18b5c0",
      kind: "build",
      cwd: "/tmp",
      currentModelId: "grok-4.5"
    },
    "x.ai/sessionConfig": {
      options: [
        { id: "grok-4.5", category: "model", label: "Grok 4.5", selected: true },
        { id: "high", category: "mode", label: "High Effort", selected: false },
        { id: "medium", category: "mode", label: "Medium Effort", selected: true },
        { id: "low", category: "mode", label: "Low Effort", selected: false }
      ]
    }
  }
};

const emptyBase: SessionMeta = { modes: null, models: null, configOptions: [] };

describe("applyGrokVendorSessionMeta", () => {
  it("synthesizes modes, models, and effort (thought_level) from Grok fixture", () => {
    const next = applyGrokVendorSessionMeta(GROK_SESSION_NEW_FIXTURE, emptyBase);
    expect(next.modes?.currentModeId).toBe("build");
    expect(next.modes?.availableModes.map((entry) => entry.id)).toEqual(
      GROK_SESSION_MODES.map((entry) => entry.id)
    );
    expect(next.models?.currentModelId).toBe("grok-4.5");
    expect(next.models?.availableModels).toHaveLength(1);
    const model = next.configOptions.find((option) => option.id === GROK_MODEL_CONFIG_ID);
    expect(model).toMatchObject({
      type: "select",
      category: "model",
      currentValue: "grok-4.5"
    });
    const thought = next.configOptions.find((option) => option.id === GROK_REASONING_EFFORT_CONFIG_ID);
    expect(thought).toMatchObject({
      type: "select",
      category: "thought_level",
      name: "Effort",
      currentValue: "medium"
    });
    if (thought?.type === "select") {
      expect(thought.options.map((option) => ("value" in option ? option.value : ""))).toEqual([
        "high",
        "medium",
        "low"
      ]);
    }
    // Effort ids must not be exposed as session modes.
    expect(next.modes?.availableModes.some((entry) => entry.id === "high")).toBe(false);
  });

  it("uses sessionDetail.kind as current mode when present", () => {
    const raw = {
      ...GROK_SESSION_NEW_FIXTURE,
      _meta: {
        ...(GROK_SESSION_NEW_FIXTURE._meta as object),
        "x.ai/sessionDetail": {
          sessionId: "x",
          kind: "plan",
          cwd: "/tmp",
          currentModelId: "grok-4.5"
        }
      }
    };
    const next = applyGrokVendorSessionMeta(raw, emptyBase);
    expect(next.modes?.currentModeId).toBe("plan");
  });

  it("does not override official thought_level, model, or modes", () => {
    const base: SessionMeta = {
      modes: {
        currentModeId: "official-mode",
        availableModes: [{ id: "official-mode", name: "Official Mode" }]
      },
      models: { currentModelId: "official", availableModels: [{ modelId: "official", name: "Official" }] },
      configOptions: [
        {
          type: "select",
          id: "model",
          name: "Model",
          category: "model",
          currentValue: "official",
          options: [{ value: "official", name: "Official" }]
        },
        {
          type: "select",
          id: "effort",
          name: "Thinking",
          category: "thought_level",
          currentValue: "max",
          options: [{ value: "max", name: "Max" }]
        }
      ]
    };
    const next = applyGrokVendorSessionMeta(GROK_SESSION_NEW_FIXTURE, base);
    expect(next).toEqual(base);
  });

  it("returns base when raw is empty", () => {
    expect(applyGrokVendorSessionMeta(null, emptyBase)).toEqual(emptyBase);
  });
});
