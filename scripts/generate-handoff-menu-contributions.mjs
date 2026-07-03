#!/usr/bin/env node

const HANDOFF_SUBMENU_ID = "agentResume.handoffTo";

function handoffCommandId(provider) {
  return `agentResume.handoffTo.${provider}`;
}

const CLI_TARGETS = [
  { provider: "codex", label: "Codex" },
  { provider: "claude", label: "Claude Code" },
  { provider: "agy", label: "Antigravity CLI" },
  { provider: "grok", label: "Grok Build" },
  { provider: "opencode", label: "OpenCode" },
  { provider: "pi", label: "Pi" }
];

const ACP_TARGETS = [
  { provider: "codex", label: "Codex" },
  { provider: "claude", label: "Claude Code" },
  { provider: "grok", label: "Grok Build" },
  { provider: "opencode", label: "OpenCode" },
  { provider: "pi", label: "Pi" }
];

const SESSION_SOURCE_WHEN =
  "view == agentResume.sessions && viewItem =~ /agentResume\\.session\\.(codex|claude|agy|grok|opencode|pi)/";

const ACP_SOURCE_WHEN = "view == agentResume.acpChats && viewItem =~ /agentResume\\.acpChat\\./";

export function buildHandoffMenuContributionBlocks() {
  return {
    handoffSubmenu: {
      id: HANDOFF_SUBMENU_ID,
      label: "Hand Off to Another Agent"
    },
    sessionHandoffTrigger: [
      {
        submenu: HANDOFF_SUBMENU_ID,
        when: SESSION_SOURCE_WHEN,
        group: "navigation@55"
      }
    ],
    acpHandoffTrigger: [
      {
        submenu: HANDOFF_SUBMENU_ID,
        when: ACP_SOURCE_WHEN,
        group: "navigation@2"
      }
    ],
    handoffSubmenuItems: [
      ...CLI_TARGETS.map((target, index) => ({
        command: handoffCommandId(target.provider),
        when: `${SESSION_SOURCE_WHEN} && viewItem != agentResume.session.${target.provider}`,
        group: `handoff@${index + 1}`
      })),
      ...ACP_TARGETS.map((target, index) => ({
        command: handoffCommandId(target.provider),
        when: `${ACP_SOURCE_WHEN} && viewItem != agentResume.acpChat.${target.provider}`,
        group: `handoff@${index + 1}`
      }))
    ],
    acpContextEntries: [
      {
        command: "agentResume.openAcpChat",
        when: "view == agentResume.acpChats && viewItem =~ /agentResume\\.acpChat\\./",
        group: "inline@1"
      },
      {
        command: "agentResume.renameAcpChat",
        when: "view == agentResume.acpChats && viewItem =~ /agentResume\\.acpChat\\./",
        group: "navigation@0"
      },
      {
        command: "agentResume.newChatSession",
        when: "view == agentResume.acpChats && viewItem == agentResume.acpProject",
        group: "navigation@1"
      }
    ],
    handoffCommands: [
      ...new Map(
        [...CLI_TARGETS, ...ACP_TARGETS].map((target) => [
          target.provider,
          {
            command: handoffCommandId(target.provider),
            title: `Hand Off to ${target.label}`,
            category: "Agent Resume"
          }
        ])
      ).values()
    ],
    handoffConfiguration: {
      "agentResume.handoff.attachRecentVerbatim": {
        type: "number",
        default: 5,
        minimum: 0,
        maximum: 20,
        description: "Number of recent verbatim exchanges appended after the handoff brief."
      },
      "agentResume.handoff.maxBriefTokens": {
        type: "number",
        default: 2500,
        minimum: 500,
        maximum: 8000,
        description: "Maximum LLM output tokens for the generated handoff brief."
      }
    }
  };
}