import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { syncPanelProvidersToThunder } from "./thunderProviderSync";
import type { PanelSettings } from "@agent-resume/core";

describe("thunderProviderSync", () => {
  it("exports tool and chat LLM plus custom providers into Thunder models.json and auth.json", async () => {
    const tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), "panel-thunder-test-"));

    const sampleSettings: PanelSettings = {
      panelHome: tmpHome,
      uiLanguage: "en",
      llm: {
        baseUrl: "https://test-api.example.com/v1",
        model: "gpt-5.4-mini",
        apiKey: "sk-tool-key-123"
      },
      chatLlm: {
        baseUrl: "https://chat-api.example.com/v1",
        model: "gpt-5.6-terra",
        apiKey: "sk-chat-key-456"
      },
      embedding: {
        model: "text-embedding-3-small"
      },
      providers: [
        {
          id: "custom-deepseek",
          name: "DeepSeek Direct",
          baseUrl: "https://api.deepseek.com/v1",
          apiKey: "sk-deepseek-789",
          models: [
            { id: "deepseek-chat", kind: "text" },
            { id: "deepseek-reasoner", kind: "text" },
            { id: "text-embed", kind: "embedding" } // embedding should be filtered out
          ]
        }
      ]
    };

    const res = await syncPanelProvidersToThunder(sampleSettings);

    expect(res.configDir).toBe(path.join(tmpHome, "thunder"));
    expect(res.providersCount).toBe(3); // panel-default, panel-chat, custom-deepseek
    expect(res.modelsCount).toBe(4); // gpt-5.4-mini, gpt-5.6-terra, deepseek-chat, deepseek-reasoner

    const modelsRaw = await fs.readFile(path.join(res.configDir, "models.json"), "utf8");
    const modelsData = JSON.parse(modelsRaw);

    expect(modelsData.providers["panel-default"]).toBeDefined();
    expect(modelsData.providers["panel-default"].baseUrl).toBe("https://test-api.example.com/v1");
    expect(modelsData.providers["panel-default"].models[0].id).toBe("gpt-5.4-mini");

    expect(modelsData.providers["panel-chat"]).toBeDefined();
    expect(modelsData.providers["panel-chat"].baseUrl).toBe("https://chat-api.example.com/v1");
    expect(modelsData.providers["panel-chat"].models[0].id).toBe("gpt-5.6-terra");

    expect(modelsData.providers["custom-deepseek"]).toBeDefined();
    expect(modelsData.providers["custom-deepseek"].models.map((m: any) => m.id)).toEqual([
      "deepseek-chat",
      "deepseek-reasoner"
    ]);

    const authRaw = await fs.readFile(path.join(res.configDir, "auth.json"), "utf8");
    const authData = JSON.parse(authRaw);

    expect(authData["panel-default"].apiKey).toBe("sk-tool-key-123");
    expect(authData["panel-chat"].apiKey).toBe("sk-chat-key-456");
    expect(authData["custom-deepseek"].apiKey).toBe("sk-deepseek-789");

    // Clean up
    await fs.rm(tmpHome, { recursive: true, force: true });
  });
});
