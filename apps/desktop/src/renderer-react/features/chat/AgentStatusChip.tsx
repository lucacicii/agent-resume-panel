/**
 * What the run is doing right now, in the chat header.
 *
 * The phase comes from thunder's execution-status plugin (`agent_status`) —
 * the one authority for the question — rather than from watching the transcript
 * scroll by. Two phases are the reason it is worth a chip of its own: a run
 * parked on a question or on a permission gate looks exactly like a run that is
 * thinking from the outside, and only thunder knows which one it is.
 *
 * A resting run shows nothing. `idle` and `done` are the states the transcript
 * already speaks for, and a chip that never goes away stops being read.
 */

import React from "react";
import type { ThunderAgentPhase, ThunderAgentStatus } from "@agent-resume/core";
import { useI18n } from "../../i18n";

/** Phases worth a chip, and the tone each one carries. */
const TONES: Partial<Record<ThunderAgentPhase, "running" | "awaiting" | "error">> = {
  thinking: "running",
  streaming: "running",
  tool: "running",
  compacting: "running",
  awaiting_user: "awaiting",
  paused: "awaiting",
  error: "error"
};

const LABEL_KEYS: Partial<Record<ThunderAgentPhase, string>> = {
  thinking: "desktop.chat.agentStatus.thinking",
  streaming: "desktop.chat.agentStatus.streaming",
  tool: "desktop.chat.agentStatus.tool",
  compacting: "desktop.chat.agentStatus.compacting",
  awaiting_user: "desktop.chat.agentStatus.awaitingUser",
  paused: "desktop.chat.agentStatus.paused",
  error: "desktop.chat.agentStatus.error"
};

export function AgentStatusChip({
  status
}: {
  status?: ThunderAgentStatus | null;
}): React.ReactElement | null {
  const { t } = useI18n();
  if (!status) return null;

  const tone = TONES[status.phase];
  const labelKey = LABEL_KEYS[status.phase];
  if (!tone || !labelKey) return null;

  // `tool` is the one phase whose label cannot be written in advance: the run
  // is not "running a tool", it is running *this* one.
  const label =
    status.phase === "tool" && status.tool
      ? t(labelKey, status.tool)
      : t(labelKey);

  return (
    <span
      className={`tb-agent-status is-${tone}`}
      title={status.detail || label}
      // The transcript already announces every change; a live region here would
      // read the same news twice.
      aria-live="off"
    >
      <span className="tb-agent-status-dot" aria-hidden="true" />
      <span>{label}</span>
      {status.turn > 0 ? (
        <span className="tb-agent-status-turn">{t("desktop.chat.agentStatus.turn", status.turn)}</span>
      ) : null}
    </span>
  );
}
