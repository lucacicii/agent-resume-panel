import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThunderPane } from "./ThunderPane";

const t = (key: string, ...args: Array<string | number>) =>
  key.replace("{0}", String(args[0] ?? ""));

const draft = { repoPath: "", daemonPath: "" };

const modelsConfig = {
  providers: {
    command: {
      name: "command",
      api: "openai-completions",
      baseUrl: "https://api.example.test/v1",
      apiKey: "sk-secret",
      models: [
        { id: "model-a", name: "Model A", contextWindow: 128000, reasoning: true, defaultThinkingLevel: "high" }
      ]
    }
  },
  utilityModel: "command/model-a"
};

const thunderReadModelsConfig = vi.fn(async () => modelsConfig);
const thunderWriteModelsConfig = vi.fn(async (_args: { config: typeof modelsConfig }) => undefined);

function renderPane() {
  return render(
    <ThunderPane
      draft={draft}
      setDraft={vi.fn()}
      commit={vi.fn()}
      t={t as never}
    />
  );
}

describe("ThunderPane models editor", () => {
  beforeEach(() => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    window.agentResume = {
      thunderGetStatus: vi.fn(async () => ({ available: false, repoPath: null, daemonPath: null, models: [], source: "none" })),
      thunderReadModelsConfig,
      thunderWriteModelsConfig,
      onThunderModelsChanged: () => () => undefined
    } as never;
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders the models editor with provider fields and a masked key", async () => {
    renderPane();
    await waitFor(() => expect(screen.getAllByDisplayValue("sk-secret").length).toBeGreaterThan(0));
    const keyInput = screen.getAllByDisplayValue("sk-secret")[0] as HTMLInputElement;
    expect(keyInput.type).toBe("password");
    expect(screen.getAllByDisplayValue("command").length).toBeGreaterThan(0);
  });

  it("saves the models config through the file writer", async () => {
    renderPane();
    await waitFor(() => expect(screen.getAllByDisplayValue("sk-secret").length).toBeGreaterThan(0));
    fireEvent.click(screen.getByText("desktop.settings.thunderModelsSave"));
    await waitFor(() => expect(thunderWriteModelsConfig).toHaveBeenCalledTimes(1));
    expect(thunderWriteModelsConfig.mock.calls[0][0].config.utilityModel).toBe("command/model-a");
  });
});
