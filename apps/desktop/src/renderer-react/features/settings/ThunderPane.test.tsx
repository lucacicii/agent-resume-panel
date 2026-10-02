import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThunderPane } from "./ThunderPane";
import type { ThunderRoleRecord } from "@agent-resume/core";

const t = (key: string, ...args: Array<string | number>) =>
  key.replace("{0}", String(args[0] ?? ""));

const draft = { repoPath: "", daemonPath: "" };

const roleRecords: ThunderRoleRecord[] = [
  { raw: { id: "plan", name: "Plan", permission: "read", mode: "plan", enabled: true }, builtin: true },
  { raw: { id: "architect", name: "Architect", permission: "write", mode: "accept_edits", enabled: true }, builtin: true },
  { raw: { id: "pm", name: "Project Manager", permission: "read", mode: "plan", enabled: true }, builtin: true },
  { raw: { id: "reviewer", name: "Reviewer", permission: "read", enabled: true }, builtin: false }
];

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

const thunderReadRolesFile = vi.fn(async () => roleRecords);
const thunderWriteRolesFile = vi.fn(async (_args: { records: ThunderRoleRecord[] }) => undefined);
const thunderResetBuiltinRole = vi.fn(async (_args: { id: string }) => undefined);
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

describe("ThunderPane roles editor", () => {
  beforeEach(() => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    window.agentResume = {
      thunderGetStatus: vi.fn(async () => ({ available: false, repoPath: null, daemonPath: null, models: [], source: "none" })),
      thunderReadRolesFile,
      thunderWriteRolesFile,
      thunderResetBuiltinRole,
      thunderReadModelsConfig,
      thunderWriteModelsConfig,
      onThunderRolesChanged: () => () => undefined,
      onThunderModelsChanged: () => () => undefined
    } as never;
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("lists roles, marking the built-ins", async () => {
    renderPane();
    await waitFor(() => expect(screen.getAllByDisplayValue(/plan/i).length).toBeGreaterThan(0));
    const badges = screen.getAllByText("desktop.settings.thunderRolesBuiltin");
    expect(badges.length).toBe(3);
    expect(screen.queryAllByDisplayValue("reviewer").length).toBeGreaterThan(0);
  });

  it("locks built-in ids but leaves custom ids editable", async () => {
    renderPane();
    await waitFor(() => expect(screen.getAllByDisplayValue("reviewer").length).toBeGreaterThan(0));
    const reviewerInput = screen.getAllByDisplayValue("reviewer")[0] as HTMLInputElement;
    const planInput = screen.getAllByDisplayValue("plan")[0] as HTMLInputElement;
    expect(planInput.disabled).toBe(true);
    expect(reviewerInput.disabled).toBe(false);
  });

  it("saves the full record list through the file writer", async () => {
    renderPane();
    await waitFor(() => expect(screen.getAllByDisplayValue("reviewer").length).toBeGreaterThan(0));
    fireEvent.click(screen.getByText("desktop.settings.thunderRolesSave"));
    await waitFor(() => expect(thunderWriteRolesFile).toHaveBeenCalledTimes(1));
    const written = thunderWriteRolesFile.mock.calls[0][0].records as ThunderRoleRecord[];
    expect(written.map((r) => String(r.raw.id))).toEqual(["plan", "architect", "pm", "reviewer"]);
  });

  it("resets a built-in role via the dedicated IPC (not the bulk write)", async () => {
    renderPane();
    await waitFor(() => expect(screen.getAllByDisplayValue("plan").length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByText("desktop.settings.thunderRolesReset")[0]);
    await waitFor(() => expect(thunderResetBuiltinRole).toHaveBeenCalledWith({ id: "plan" }));
    expect(thunderWriteRolesFile).not.toHaveBeenCalled();
  });

  it("adds a custom role and keeps it editable", async () => {
    renderPane();
    await waitFor(() => expect(screen.getAllByDisplayValue("reviewer").length).toBeGreaterThan(0));
    fireEvent.click(screen.getByText("desktop.settings.thunderRolesAdd"));
    const idInputs = screen
      .getAllByRole("textbox")
      .filter((el) => (el as HTMLInputElement).className.includes("tb-role-id"));
    expect(idInputs.length).toBe(5); // 4 loaded + 1 new
    expect(screen.getAllByText("desktop.settings.thunderRolesBuiltin").length).toBe(3);
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
