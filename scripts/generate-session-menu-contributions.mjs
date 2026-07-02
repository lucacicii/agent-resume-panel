#!/usr/bin/env node

const SESSION_VIEW_WHEN =
  "view == agentResume.sessions && viewItem =~ /agentResume\\.session\\.(codex|claude|agy|grok|alma|opencode|pi)/";

const ACTIONS = [
  "copyResumeCommand",
  "openProject",
  "openInGhostty",
  "previewSession",
  "renameSession",
  "removeSessionFromPanel",
  "autoRenameSession"
];

const COMMANDS = {
  copyResumeCommand: [{ command: "agentResume.copyResumeCommand" }],
  openProject: [{ command: "agentResume.openProject" }],
  openInGhostty: [{ command: "agentResume.openInGhostty" }],
  previewSession: [{ command: "agentResume.previewSession" }],
  renameSession: [{ command: "agentResume.renameSession" }],
  removeSessionFromPanel: [{ command: "agentResume.removeSessionFromPanel" }],
  autoRenameSession: [{ command: "agentResume.autoRenameSession" }]
};

const MAIN_SLOT_START = 1;
const MAIN_SLOT_COUNT = ACTIONS.length;
const MORE_SLOT_START = 0;
const MORE_SLOT_COUNT = ACTIONS.length;

function buildWhenClause(action, slotKey, visibilityClause) {
  return `${SESSION_VIEW_WHEN} && ${visibilityClause} && ${slotKey} == ${action}`;
}

function buildMainSessionMenuEntries() {
  const entries = [];

  for (let slot = MAIN_SLOT_START; slot < MAIN_SLOT_START + MAIN_SLOT_COUNT; slot++) {
    for (const action of ACTIONS) {
      for (const spec of COMMANDS[action]) {
        entries.push({
          command: spec.command,
          when: buildWhenClause(action, `agentResume.sessionMenu.at${slot}`, `agentResume.sessionMenu.main.${action}`),
          group: `navigation@${slot}`
        });
      }
    }
  }

  return entries;
}

function buildMoreSessionMenuEntries() {
  const entries = [];

  for (let slot = MORE_SLOT_START; slot < MORE_SLOT_START + MORE_SLOT_COUNT; slot++) {
    for (const action of ACTIONS) {
      for (const spec of COMMANDS[action]) {
        entries.push({
          command: spec.command,
          when: buildWhenClause(
            action,
            `agentResume.sessionMenu.moreAt${slot}`,
            `!agentResume.sessionMenu.main.${action}`
          ),
          group: `navigation@${slot + MORE_SLOT_START}`
        });
      }
    }
  }

  entries.push({
    command: "agentResume.configureSessionMenu",
    when: SESSION_VIEW_WHEN,
    group: "config@1"
  });

  entries.push({
    submenu: "agentResume.sessionSort",
    when: SESSION_VIEW_WHEN,
    group: "sort@1"
  });

  return entries;
}

export function buildSessionMenuContributionBlocks() {
  return {
    sessionMenuPrefix: [
      {
        command: "agentResume.openSession",
        when:
          "view == agentResume.sessions && viewItem =~ /agentResume\\.session\\.(codex|claude|agy|grok|opencode|pi)/",
        group: "inline@1"
      },
      {
        command: "agentResume.openFolder",
        when: SESSION_VIEW_WHEN,
        group: "navigation@0"
      }
    ],
    mainSessionMenu: buildMainSessionMenuEntries(),
    sessionMoreTrigger: [
      {
        submenu: "agentResume.sessionMore",
        when: SESSION_VIEW_WHEN,
        group: "navigation@50"
      }
    ],
    sessionMenuSuffix: [
      {
        command: "agentResume.openInCodexApp",
        when: "view == agentResume.sessions && viewItem == agentResume.session.codex",
        group: "navigation@60"
      },
      {
        command: "agentResume.openInClaudeCodePanel",
        when: "view == agentResume.sessions && viewItem == agentResume.session.claude",
        group: "navigation@60"
      },
      {
        command: "agentResume.openInCodexIdePanel",
        when:
          "view == agentResume.sessions && viewItem == agentResume.session.codex && agentResume.codexIdePanelResume.enabled",
        group: "navigation@60"
      }
    ],
    moreSessionMenu: buildMoreSessionMenuEntries(),
    sessionSortMenu: [
      {
        command: "agentResume.sortProjectSessionsUpdatedDesc",
        when: SESSION_VIEW_WHEN,
        group: "sort@1"
      },
      {
        command: "agentResume.sortProjectSessionsUpdatedAsc",
        when: SESSION_VIEW_WHEN,
        group: "sort@2"
      },
      {
        command: "agentResume.sortProjectSessionsTitleAsc",
        when: SESSION_VIEW_WHEN,
        group: "sort@3"
      },
      {
        command: "agentResume.sortProjectSessionsTitleDesc",
        when: SESSION_VIEW_WHEN,
        group: "sort@4"
      }
    ],
    projectSortExtras: [
      {
        submenu: "agentResume.projectSort",
        when: "view == agentResume.sessions && viewItem =~ /agentResume\\.project/",
        group: "sort@1"
      }
    ],
    projectSortMenu: [
      {
        command: "agentResume.sortProjectSessionsUpdatedDesc",
        when: "view == agentResume.sessions && viewItem =~ /agentResume\\.project/",
        group: "sort@1"
      },
      {
        command: "agentResume.sortProjectSessionsUpdatedAsc",
        when: "view == agentResume.sessions && viewItem =~ /agentResume\\.project/",
        group: "sort@2"
      },
      {
        command: "agentResume.sortProjectSessionsTitleAsc",
        when: "view == agentResume.sessions && viewItem =~ /agentResume\\.project/",
        group: "sort@3"
      },
      {
        command: "agentResume.sortProjectSessionsTitleDesc",
        when: "view == agentResume.sessions && viewItem =~ /agentResume\\.project/",
        group: "sort@4"
      }
    ]
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(JSON.stringify(buildSessionMenuContributionBlocks(), null, 2));
}