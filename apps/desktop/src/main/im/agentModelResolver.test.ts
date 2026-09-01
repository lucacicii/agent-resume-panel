import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PanelSettings } from "@agent-resume/core";
import { resolveAgentModels } from "./agentModelResolver";

describe("agentModelResolver", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-model-resolver-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("discovers models from Pi native configuration files", async () => {
    const piDir = path.join(tmpDir, "pi");
    await fs.mkdir(piDir, { recursive: true });

    // Write models.json
    await fs.writeFile(
      path.join(piDir, "models.json"),
      JSON.stringify({
        providers: {
          "my-provider": {
            name: "My Custom Provider",
            models: [
              { id: "gpt-5.6-luna", name: "GPT 5.6 Luna" },
              { id: "gpt-5.6-terra", name: "GPT 5.6 Terra" }
            ]
          }
        }
      })
    );

    // Write settings.json
    await fs.writeFile(
      path.join(piDir, "settings.json"),
      JSON.stringify({
        defaultModel: "deepseek-v4-flash",
        enabledModels: ["custom-model-1"]
      })
    );

    const settings = {
      agentHomes: {
        piHome: piDir
      }
    } as unknown as PanelSettings;

    const models = await resolveAgentModels("pi", settings);
    const modelIds = models.map((m) => m.id);

    expect(modelIds).toContain("gpt-5.6-luna");
    expect(modelIds).toContain("gpt-5.6-terra");
    expect(modelIds).toContain("deepseek-v4-flash");
    expect(modelIds).toContain("custom-model-1");

    const luna = models.find((m) => m.id === "gpt-5.6-luna");
    expect(luna?.label).toContain("GPT 5.6 Luna");
    expect(luna?.provider).toBe("My Custom Provider");
  });

  it("merges Desktop provider models and curated models", async () => {
    const settings = {
      agentHomes: {
        piHome: path.join(tmpDir, "empty")
      },
      providers: [
        {
          id: "prov-1",
          name: "OpenAI Gateway",
          baseUrl: "https://api.openai.com/v1",
          models: [
            { id: "custom-llm", kind: "text" },
            { id: "custom-embed", kind: "embedding" }
          ]
        }
      ]
    } as unknown as PanelSettings;

    const models = await resolveAgentModels("claude", settings);
    const modelIds = models.map((m) => m.id);

    expect(modelIds).toContain("claude-3-7-sonnet-20250219");
    expect(modelIds).toContain("custom-llm");
    expect(modelIds).not.toContain("custom-embed");
  });
});
