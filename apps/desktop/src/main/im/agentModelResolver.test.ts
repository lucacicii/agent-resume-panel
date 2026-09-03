import { beforeEach, describe, expect, it, vi } from "vitest";
import { getLiveAcpAgentModels, probeAcpAgentModels } from "../acp/acpHost";
import { resolveAgentModels } from "./agentModelResolver";

vi.mock("../acp/acpHost", () => ({
  getLiveAcpAgentModels: vi.fn(),
  probeAcpAgentModels: vi.fn()
}));

describe("agentModelResolver", () => {
  beforeEach(() => {
    vi.mocked(getLiveAcpAgentModels).mockReset();
    vi.mocked(probeAcpAgentModels).mockReset();
  });

  it("returns live ACP session models without spawning a probe", async () => {
    vi.mocked(getLiveAcpAgentModels).mockReturnValue([
      { id: "claude-sonnet-4-5", label: "Claude Sonnet 4.5" },
      { id: "claude-opus-4-1", label: "" }
    ]);

    const models = await resolveAgentModels("claude");

    expect(models).toEqual([
      { id: "claude-sonnet-4-5", label: "Claude Sonnet 4.5", provider: "ACP" },
      { id: "claude-opus-4-1", label: "claude-opus-4-1", provider: "ACP" }
    ]);
    expect(getLiveAcpAgentModels).toHaveBeenCalledWith("claude");
    expect(probeAcpAgentModels).not.toHaveBeenCalled();
  });

  it("probes a throwaway ACP session when refresh is requested", async () => {
    vi.mocked(probeAcpAgentModels).mockResolvedValue([{ id: "o3-mini", label: "o3 mini" }]);

    const models = await resolveAgentModels("codex", { refresh: true });

    expect(probeAcpAgentModels).toHaveBeenCalledWith("codex");
    expect(models).toEqual([{ id: "o3-mini", label: "o3 mini", provider: "ACP" }]);
  });

  it("returns an empty list when no live ACP session exists", async () => {
    vi.mocked(getLiveAcpAgentModels).mockReturnValue([]);

    expect(await resolveAgentModels("codex")).toEqual([]);
  });
});
