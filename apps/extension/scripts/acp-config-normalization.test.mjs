#!/usr/bin/env node

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  normalizeConfigOptionsArray,
  normalizeSessionConfigOptions
} = require(path.join(import.meta.dirname, "..", "out", "acp", "configNormalization.js"));

test("normalizeConfigOptionsArray handles flat select, grouped select, boolean, and deterministic sorting", () => {
  const result = normalizeConfigOptionsArray([
    {
      id: "custom_flag",
      name: "Verbose",
      description: "Enable verbose output",
      type: "boolean",
      currentValue: true
    },
    {
      id: "reasoning",
      name: "Reasoning",
      category: "thought_level",
      type: "select",
      currentValue: "high",
      options: [
        { value: "low", name: "Low" },
        { value: "high", name: "High" }
      ]
    },
    {
      id: "model",
      name: "Model",
      category: "model",
      type: "select",
      currentValue: "claude-sonnet-4",
      options: [
        {
          group: "anthropic",
          name: "Anthropic",
          options: [
            { value: "claude-sonnet-4", name: "Claude Sonnet 4" },
            { value: "claude-opus-4", name: "Claude Opus 4" }
          ]
        }
      ]
    },
    {
      id: "mode",
      name: "Mode",
      category: "mode",
      type: "select",
      currentValue: "code",
      options: [
        { value: "ask", name: "Ask" },
        { value: "code", name: "Code" }
      ]
    }
  ]);

  assert.deepEqual(
    result.map((opt) => opt.id),
    ["mode", "model", "reasoning", "custom_flag"]
  );
  assert.equal(result[1].type, "select");
  assert.equal(result[1].groups?.length, 1);
  assert.equal(result[1].options.length, 2);
  assert.equal(result[3].type, "boolean");
  assert.equal(result[3].currentValue, true);
  assert.equal(result[3].source, "configOption");
});

test("normalizeSessionConfigOptions synthesizes legacy modes and models without duplicating configOptions", () => {
  const legacyOnly = normalizeSessionConfigOptions({
    modes: {
      currentModeId: "plan",
      availableModes: [
        { id: "plan", name: "Plan" },
        { id: "agent", name: "Agent" }
      ]
    },
    models: {
      currentModelId: "gpt-5",
      availableModels: [
        { modelId: "gpt-5", name: "GPT-5" },
        { modelId: "gpt-5-mini", name: "GPT-5 Mini" }
      ]
    }
  });

  assert.equal(legacyOnly.modes?.currentModeId, "plan");
  assert.deepEqual(
    legacyOnly.configOptions.map((opt) => [opt.id, opt.source, opt.currentValue]),
    [
      ["mode", "mode", "plan"],
      ["model", "model", "gpt-5"]
    ]
  );

  const deduplicated = normalizeSessionConfigOptions({
    configOptions: [
      {
        id: "session_mode",
        name: "Session Mode",
        category: "mode",
        type: "select",
        currentValue: "auto",
        options: [{ value: "auto", name: "Auto" }]
      },
      {
        id: "selected_model",
        name: "Selected Model",
        category: "model",
        type: "select",
        currentValue: "o3",
        options: [{ value: "o3", name: "o3" }]
      }
    ],
    modes: {
      currentModeId: "legacy",
      availableModes: [{ id: "legacy", name: "Legacy" }]
    },
    models: {
      currentModelId: "legacy-model",
      availableModels: [{ modelId: "legacy-model", name: "Legacy Model" }]
    }
  });

  assert.deepEqual(
    deduplicated.configOptions.map((opt) => [opt.id, opt.source]),
    [
      ["session_mode", "configOption"],
      ["selected_model", "configOption"]
    ]
  );
  assert.equal(deduplicated.modes?.currentModeId, "legacy");

  const piAcpPayload = normalizeSessionConfigOptions({
    configOptions: [
      {
        type: "select",
        id: "model",
        category: "model",
        name: "Model",
        currentValue: "openai/gpt-5",
        options: [{ value: "openai/gpt-5", name: "GPT-5" }]
      },
      {
        type: "select",
        id: "thought_level",
        category: "thought_level",
        name: "Thinking",
        currentValue: "medium",
        options: [
          { value: "off", name: "Off" },
          { value: "medium", name: "Medium" },
          { value: "high", name: "High" }
        ]
      }
    ],
    models: {
      currentModelId: "openai/gpt-5",
      availableModels: [{ modelId: "openai/gpt-5", name: "GPT-5" }]
    },
    modes: {
      currentModeId: "medium",
      availableModes: [
        { id: "off", name: "Off" },
        { id: "medium", name: "Medium" },
        { id: "high", name: "High" }
      ]
    }
  });

  assert.deepEqual(
    piAcpPayload.configOptions.map((opt) => [opt.id, opt.category, opt.source]),
    [
      ["model", "model", "configOption"],
      ["thought_level", "thought_level", "configOption"]
    ]
  );
  assert.equal(piAcpPayload.modes?.currentModeId, "medium");
});
