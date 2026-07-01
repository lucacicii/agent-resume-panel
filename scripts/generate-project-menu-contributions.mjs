#!/usr/bin/env node

const PROJECT_VIEW_WHEN = "view == agentResume.sessions && viewItem =~ /agentResume\\.project/";

const ACTIONS = [
  "favorite",
  "openProject",
  "openInGhostty",
  "newChatSession",
  "newCodexSession",
  "newClaudeSession",
  "newAgySession",
  "newGrokSession",
  "newOpenCodeSession",
  "newPiSession",
  "newAlmaSession",
  "newCodexAppSession"
];

const COMMANDS = {
  favorite: [
    {
      command: "agentResume.favoriteProject",
      whenExtra: "viewItem != agentResume.project.favorited"
    },
    {
      command: "agentResume.unfavoriteProject",
      whenExtra: "viewItem == agentResume.project.favorited"
    }
  ],
  openProject: [{ command: "agentResume.openProject" }],
  openInGhostty: [{ command: "agentResume.openInGhostty" }],
  newChatSession: [{ command: "agentResume.newChatSession" }],
  newCodexSession: [{ command: "agentResume.newCodexSession" }],
  newClaudeSession: [{ command: "agentResume.newClaudeSession" }],
  newAgySession: [{ command: "agentResume.newAgySession" }],
  newGrokSession: [{ command: "agentResume.newGrokSession" }],
  newOpenCodeSession: [{ command: "agentResume.newOpenCodeSession" }],
  newPiSession: [{ command: "agentResume.newPiSession" }],
  newAlmaSession: [{ command: "agentResume.newAlmaSession" }],
  newCodexAppSession: [{ command: "agentResume.newCodexAppSession" }]
};

const MAIN_SLOT_START = 1;
const MAIN_SLOT_COUNT = ACTIONS.length;
const MORE_SLOT_START = 0;
const MORE_SLOT_COUNT = ACTIONS.length;

function buildWhenClause(action, slotKey, visibilityClause, whenExtra = "") {
  const extra = whenExtra ? `${whenExtra} && ` : "";
  return `${PROJECT_VIEW_WHEN} && ${extra}${visibilityClause} && ${slotKey} == ${action}`;
}

function buildMainProjectMenuEntries() {
  const entries = [];

  for (let slot = MAIN_SLOT_START; slot < MAIN_SLOT_START + MAIN_SLOT_COUNT; slot++) {
    for (const action of ACTIONS) {
      for (const spec of COMMANDS[action]) {
        entries.push({
          command: spec.command,
          when: buildWhenClause(
            action,
            `agentResume.projectMenu.at${slot}`,
            `agentResume.projectMenu.main.${action}`,
            spec.whenExtra
          ),
          group: `navigation@${slot}`
        });
      }
    }
  }

  return entries;
}

function buildMoreProjectMenuEntries() {
  const entries = [];

  for (let slot = MORE_SLOT_START; slot < MORE_SLOT_START + MORE_SLOT_COUNT; slot++) {
    for (const action of ACTIONS) {
      for (const spec of COMMANDS[action]) {
        entries.push({
          command: spec.command,
          when: buildWhenClause(
            action,
            `agentResume.projectMenu.moreAt${slot}`,
            `!agentResume.projectMenu.main.${action}`,
            spec.whenExtra
          ),
          group: `navigation@${slot + MORE_SLOT_START}`
        });
      }
    }
  }

  entries.push({
    command: "agentResume.configureProjectMenu",
    when: PROJECT_VIEW_WHEN,
    group: "config@1"
  });

  return entries;
}

export function buildProjectMenuContributionBlocks() {
  return {
    mainProjectMenu: buildMainProjectMenuEntries(),
    moreProjectMenu: buildMoreProjectMenuEntries()
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const blocks = buildProjectMenuContributionBlocks();
  console.log(JSON.stringify(blocks, null, 2));
}