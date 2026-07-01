import * as vscode from "vscode";

export type ProjectMenuAction =
  | "favorite"
  | "openProject"
  | "openInGhostty"
  | "newChatSession"
  | "newCodexSession"
  | "newClaudeSession"
  | "newAgySession"
  | "newGrokSession"
  | "newOpenCodeSession"
  | "newPiSession"
  | "newAlmaSession"
  | "newCodexAppSession";

export const ALL_PROJECT_MENU_ACTIONS: ProjectMenuAction[] = [
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

export const DEFAULT_MAIN_ACTIONS: ProjectMenuAction[] = ["newCodexSession", "newClaudeSession"];

const CONFIG_KEY = "projectMenu.mainActions";
const ORDER_CONFIG_KEY = "projectMenu.itemOrder";

export const PROJECT_MENU_ACTION_LABELS: Record<ProjectMenuAction, string> = {
  favorite: "Add to / Remove from Favorites",
  openProject: "Open Folder and Resume",
  openInGhostty: "Open in Ghostty",
  newChatSession: "New Chat Session",
  newCodexSession: "New Codex Session",
  newClaudeSession: "New Claude Session",
  newAgySession: "New Antigravity Session",
  newGrokSession: "New Grok Session",
  newOpenCodeSession: "New OpenCode Session",
  newPiSession: "New Pi Session",
  newAlmaSession: "New Alma Thread",
  newCodexAppSession: "New Codex App Session"
};

export interface ProjectMenuEditorState {
  order: ProjectMenuAction[];
  mainActions: ProjectMenuAction[];
  allActions: ProjectMenuAction[];
  labels: Record<ProjectMenuAction, string>;
  defaultMainActions: ProjectMenuAction[];
}

export function loadMainActions(config: vscode.WorkspaceConfiguration): ProjectMenuAction[] {
  const stored = config.get<string[]>(CONFIG_KEY, DEFAULT_MAIN_ACTIONS);
  return normalizeMainActions(stored);
}

export async function saveMainActions(
  config: vscode.WorkspaceConfiguration,
  actions: ProjectMenuAction[]
): Promise<void> {
  await config.update(CONFIG_KEY, normalizeMainActions(actions), vscode.ConfigurationTarget.Global);
}

const MAIN_MENU_SLOT_START = 1;
const MAIN_MENU_SLOT_COUNT = ALL_PROJECT_MENU_ACTIONS.length;
const MORE_MENU_SLOT_START = 0;
const MORE_MENU_SLOT_COUNT = ALL_PROJECT_MENU_ACTIONS.length;

export function loadItemOrder(config: vscode.WorkspaceConfiguration): ProjectMenuAction[] {
  const stored = config.get<string[]>(ORDER_CONFIG_KEY, []);
  const normalized = normalizeItemOrder(stored);
  return normalized.length > 0 ? normalized : ALL_PROJECT_MENU_ACTIONS;
}

export async function saveItemOrder(
  config: vscode.WorkspaceConfiguration,
  order: ProjectMenuAction[]
): Promise<void> {
  await config.update(ORDER_CONFIG_KEY, normalizeItemOrder(order), vscode.ConfigurationTarget.Global);
}

export async function applyProjectMenuContext(
  mainActions: ProjectMenuAction[],
  itemOrder: ProjectMenuAction[] = ALL_PROJECT_MENU_ACTIONS
): Promise<void> {
  const normalized = normalizeMainActions(mainActions);
  const mainSet = new Set(normalized);
  const orderedItems = normalizeItemOrder(itemOrder);
  const moreActions = orderedItems.filter((action) => !mainSet.has(action));

  for (const action of ALL_PROJECT_MENU_ACTIONS) {
    await vscode.commands.executeCommand("setContext", contextKey(action), mainSet.has(action));
  }

  for (let slot = MAIN_MENU_SLOT_START; slot < MAIN_MENU_SLOT_START + MAIN_MENU_SLOT_COUNT; slot++) {
    await vscode.commands.executeCommand("setContext", mainSlotKey(slot), undefined);
  }

  for (let index = 0; index < normalized.length; index++) {
    const slot = MAIN_MENU_SLOT_START + index;
    if (slot >= MAIN_MENU_SLOT_START + MAIN_MENU_SLOT_COUNT) {
      break;
    }
    await vscode.commands.executeCommand("setContext", mainSlotKey(slot), normalized[index]);
  }

  for (let slot = MORE_MENU_SLOT_START; slot < MORE_MENU_SLOT_START + MORE_MENU_SLOT_COUNT; slot++) {
    await vscode.commands.executeCommand("setContext", moreSlotKey(slot), undefined);
  }

  for (let index = 0; index < moreActions.length; index++) {
    const slot = MORE_MENU_SLOT_START + index;
    if (slot >= MORE_MENU_SLOT_START + MORE_MENU_SLOT_COUNT) {
      break;
    }
    await vscode.commands.executeCommand("setContext", moreSlotKey(slot), moreActions[index]);
  }
}

export function buildProjectMenuEditorState(
  mainActions: ProjectMenuAction[],
  itemOrder: ProjectMenuAction[] = ALL_PROJECT_MENU_ACTIONS
): ProjectMenuEditorState {
  const normalized = normalizeMainActions(mainActions);
  const order = normalizeItemOrder(itemOrder);

  return {
    order,
    mainActions: normalized,
    allActions: ALL_PROJECT_MENU_ACTIONS,
    labels: { ...PROJECT_MENU_ACTION_LABELS },
    defaultMainActions: [...DEFAULT_MAIN_ACTIONS]
  };
}

export function itemOrderFromEditorState(order: string[]): ProjectMenuAction[] {
  return normalizeItemOrder(order);
}

export function mainActionsFromEditorState(order: string[], checkedIds: string[]): ProjectMenuAction[] {
  const checkedSet = new Set(checkedIds.filter(isProjectMenuAction));
  const output: ProjectMenuAction[] = [];
  const seen = new Set<ProjectMenuAction>();

  for (const entry of order) {
    if (!isProjectMenuAction(entry) || !checkedSet.has(entry) || seen.has(entry)) {
      continue;
    }
    seen.add(entry);
    output.push(entry);
  }

  return output;
}

export function normalizeMainActions(actions: string[]): ProjectMenuAction[] {
  const seen = new Set<ProjectMenuAction>();
  const output: ProjectMenuAction[] = [];

  for (const entry of actions) {
    if (!isProjectMenuAction(entry) || seen.has(entry)) {
      continue;
    }
    seen.add(entry);
    output.push(entry);
  }

  return output;
}

function isProjectMenuAction(value: string): value is ProjectMenuAction {
  return ALL_PROJECT_MENU_ACTIONS.includes(value as ProjectMenuAction);
}

function normalizeItemOrder(order: string[]): ProjectMenuAction[] {
  const seen = new Set<ProjectMenuAction>();
  const output: ProjectMenuAction[] = [];

  for (const entry of order) {
    if (!isProjectMenuAction(entry) || seen.has(entry)) {
      continue;
    }
    seen.add(entry);
    output.push(entry);
  }

  for (const action of ALL_PROJECT_MENU_ACTIONS) {
    if (!seen.has(action)) {
      output.push(action);
    }
  }

  return output;
}

function contextKey(action: ProjectMenuAction): string {
  return `agentResume.projectMenu.main.${action}`;
}

function mainSlotKey(slot: number): string {
  return `agentResume.projectMenu.at${slot}`;
}

function moreSlotKey(slot: number): string {
  return `agentResume.projectMenu.moreAt${slot}`;
}