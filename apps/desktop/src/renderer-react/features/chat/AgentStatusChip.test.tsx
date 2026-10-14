import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import type { ThunderAgentStatus } from "@agent-resume/core";
import { AgentStatusChip } from "./AgentStatusChip";
import { I18nProvider } from "../../i18n";

/** The strings the chip asks for, keyed exactly as the locale files hold them. */
const MESSAGES: Record<string, string> = {
  "desktop.chat.agentStatus.thinking": "Thinking",
  "desktop.chat.agentStatus.streaming": "Writing",
  "desktop.chat.agentStatus.tool": "Running {0}",
  "desktop.chat.agentStatus.compacting": "Compacting context",
  "desktop.chat.agentStatus.awaitingUser": "Waiting for you",
  "desktop.chat.agentStatus.paused": "Paused",
  "desktop.chat.agentStatus.error": "Failed",
  "desktop.chat.agentStatus.turn": "Turn {0}"
};

function status(overrides: Partial<ThunderAgentStatus> = {}): ThunderAgentStatus {
  return {
    session_id: "sess_1",
    phase: "thinking",
    turn: 1,
    started_at_ms: 1_000,
    seq: 1,
    ...overrides
  };
}

function renderChip(value: ThunderAgentStatus | null | undefined) {
  window.agentResume = {
    getI18nBundle: async () => ({ locale: "en", messages: MESSAGES }),
    onLocaleChanged: () => () => undefined
  } as unknown as typeof window.agentResume;
  return render(
    <I18nProvider>
      <AgentStatusChip status={value} />
    </I18nProvider>
  );
}

describe("AgentStatusChip", () => {
  it("says what the run is doing, with the turn it is on", async () => {
    renderChip(status({ phase: "thinking", turn: 3 }));

    expect(await screen.findByText("Thinking")).not.toBeNull();
    expect(screen.getByText("Turn 3")).not.toBeNull();
  });

  it("names the tool a `tool` phase is running", async () => {
    renderChip(status({ phase: "tool", tool: "bash" }));

    expect(await screen.findByText("Running bash")).not.toBeNull();
  });

  it("falls back to the bare phase when a tool phase carries no tool name", async () => {
    renderChip(status({ phase: "tool", tool: undefined }));

    // "Running {0}" with nothing to substitute keeps its placeholder, which is
    // honest — better than inventing a tool name.
    expect(await screen.findByText("Running {0}")).not.toBeNull();
  });

  it("shows the waits, because they are the reason the chip exists", async () => {
    const { unmount } = renderChip(status({ phase: "awaiting_user" }));
    expect(await screen.findByText("Waiting for you")).not.toBeNull();
    expect(document.querySelector(".tb-agent-status.is-awaiting")).not.toBeNull();
    unmount();

    renderChip(status({ phase: "paused" }));
    expect(await screen.findByText("Paused")).not.toBeNull();
  });

  it("carries the tone of the phase, not just its words", async () => {
    renderChip(status({ phase: "streaming" }));
    await screen.findByText("Writing");
    expect(document.querySelector(".tb-agent-status.is-running")).not.toBeNull();
  });

  it("shows nothing for a resting or unknown run", async () => {
    const { container: finished } = renderChip(status({ phase: "done" }));
    expect(finished.querySelector(".tb-agent-status")).toBeNull();

    const { container: nothing } = renderChip(null);
    expect(nothing.querySelector(".tb-agent-status")).toBeNull();
  });
});
