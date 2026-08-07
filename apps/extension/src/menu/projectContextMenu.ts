import * as vscode from "vscode";
import { t } from "../i18n";

export type ProjectMenuAction =
  | "favorite"
  | "setProjectAlias"
  | "openProject"
  | "openInGhostty"
  | "newChatSession"
  | "newCodexSession"
  | "newClaudeSession"
  | "newAgySession"
  | "newGrokSession"
  | "newOpenCodeSession"
  | "newPiSession"
  | "newPrimeSession"
  | "newCodexAppSession"
  | "openProjectNote"
  | "deleteProjectNote";

export const ALL_PROJECT_MENU_ACTIONS: ProjectMenuAction[] = [
  "favorite",
  "setProjectAlias",
  "openProject",
  "openInGhostty",
  "newChatSession",
  "newCodexSession",
  "newClaudeSession",
  "newAgySession",
  "newGrokSession",
  "newOpenCodeSession",
  "newPiSession",
  "newPrimeSession",
  "newCodexAppSession",
  "openProjectNote",
  "deleteProjectNote"
];

export const DEFAULT_MAIN_ACTIONS: ProjectMenuAction[] = ["newCodexSession", "newClaudeSession"];

const CONFIG_KEY = "projectMenu.mainActions";
const ORDER_CONFIG_KEY = "projectMenu.itemOrder";

export function getProjectMenuActionLabels(): Record<ProjectMenuAction, string> {
  return {
    favorite: t("menu.project.favorite"),
    setProjectAlias: t("menu.project.setProjectAlias"),
    openProject: t("menu.project.openProject"),
    openInGhostty: t("menu.project.openInGhostty"),
    newChatSession: t("menu.project.newChatSession"),
    newCodexSession: t("menu.project.newCodexSession"),
    newClaudeSession: t("menu.project.newClaudeSession"),
    newAgySession: t("menu.project.newAgySession"),
    newGrokSession: t("menu.project.newGrokSession"),
    newOpenCodeSession: t("menu.project.newOpenCodeSession"),
    newPiSession: t("menu.project.newPiSession"),
    newPrimeSession: t("menu.project.newPrimeSession"),
    newCodexAppSession: t("menu.project.newCodexAppSession"),
    openProjectNote: t("menu.project.openNote"),
    deleteProjectNote: t("menu.project.deleteNote")
  };
}

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
    labels: getProjectMenuActionLabels(),
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
