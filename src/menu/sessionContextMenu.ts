import * as vscode from "vscode";

export type SessionMenuAction =
  | "copyResumeCommand"
  | "openProject"
  | "openInGhostty"
  | "previewSession"
  | "renameSession"
  | "removeSessionFromPanel"
  | "autoRenameSession";

export const ALL_SESSION_MENU_ACTIONS: SessionMenuAction[] = [
  "copyResumeCommand",
  "openProject",
  "openInGhostty",
  "previewSession",
  "renameSession",
  "removeSessionFromPanel",
  "autoRenameSession"
];

export const DEFAULT_MAIN_SESSION_ACTIONS: SessionMenuAction[] = [
  "copyResumeCommand",
  "openProject",
  "previewSession",
  "renameSession"
];

const CONFIG_KEY = "sessionMenu.mainActions";
const ORDER_CONFIG_KEY = "sessionMenu.itemOrder";

export const SESSION_MENU_ACTION_LABELS: Record<SessionMenuAction, string> = {
  copyResumeCommand: "Copy Resume Command",
  openProject: "Open Folder and Resume",
  openInGhostty: "Open in Ghostty",
  previewSession: "Preview Session",
  renameSession: "Rename Session",
  removeSessionFromPanel: "Remove from Panel",
  autoRenameSession: "Auto Rename Session"
};

const COMMAND_BY_ACTION: Record<SessionMenuAction, string> = {
  copyResumeCommand: "agentResume.copyResumeCommand",
  openProject: "agentResume.openProject",
  openInGhostty: "agentResume.openInGhostty",
  previewSession: "agentResume.previewSession",
  renameSession: "agentResume.renameSession",
  removeSessionFromPanel: "agentResume.removeSessionFromPanel",
  autoRenameSession: "agentResume.autoRenameSession"
};

export interface SessionMenuEditorState {
  order: SessionMenuAction[];
  mainActions: SessionMenuAction[];
  allActions: SessionMenuAction[];
  labels: Record<SessionMenuAction, string>;
  defaultMainActions: SessionMenuAction[];
}

export function loadMainSessionActions(config: vscode.WorkspaceConfiguration): SessionMenuAction[] {
  const stored = config.get<string[]>(CONFIG_KEY, DEFAULT_MAIN_SESSION_ACTIONS);
  return normalizeMainSessionActions(stored);
}

export async function saveMainSessionActions(
  config: vscode.WorkspaceConfiguration,
  actions: SessionMenuAction[]
): Promise<void> {
  await config.update(CONFIG_KEY, normalizeMainSessionActions(actions), vscode.ConfigurationTarget.Global);
}

const MAIN_MENU_SLOT_START = 1;
const MAIN_MENU_SLOT_COUNT = ALL_SESSION_MENU_ACTIONS.length;
const MORE_MENU_SLOT_START = 0;
const MORE_MENU_SLOT_COUNT = ALL_SESSION_MENU_ACTIONS.length;

export function loadSessionItemOrder(config: vscode.WorkspaceConfiguration): SessionMenuAction[] {
  const stored = config.get<string[]>(ORDER_CONFIG_KEY, []);
  const normalized = normalizeSessionItemOrder(stored);
  return normalized.length > 0 ? normalized : ALL_SESSION_MENU_ACTIONS;
}

export async function saveSessionItemOrder(
  config: vscode.WorkspaceConfiguration,
  order: SessionMenuAction[]
): Promise<void> {
  await config.update(ORDER_CONFIG_KEY, normalizeSessionItemOrder(order), vscode.ConfigurationTarget.Global);
}

export async function applySessionMenuContext(
  mainActions: SessionMenuAction[],
  itemOrder: SessionMenuAction[] = ALL_SESSION_MENU_ACTIONS
): Promise<void> {
  const normalized = normalizeMainSessionActions(mainActions);
  const mainSet = new Set(normalized);
  const orderedItems = normalizeSessionItemOrder(itemOrder);
  const moreActions = orderedItems.filter((action) => !mainSet.has(action));

  for (const action of ALL_SESSION_MENU_ACTIONS) {
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

export function buildSessionMenuEditorState(
  mainActions: SessionMenuAction[],
  itemOrder: SessionMenuAction[] = ALL_SESSION_MENU_ACTIONS
): SessionMenuEditorState {
  const normalized = normalizeMainSessionActions(mainActions);
  const order = normalizeSessionItemOrder(itemOrder);

  return {
    order,
    mainActions: normalized,
    allActions: ALL_SESSION_MENU_ACTIONS,
    labels: { ...SESSION_MENU_ACTION_LABELS },
    defaultMainActions: [...DEFAULT_MAIN_SESSION_ACTIONS]
  };
}

export function sessionItemOrderFromEditorState(order: string[]): SessionMenuAction[] {
  return normalizeSessionItemOrder(order);
}

export function mainSessionActionsFromEditorState(order: string[], checkedIds: string[]): SessionMenuAction[] {
  const checkedSet = new Set(checkedIds.filter(isSessionMenuAction));
  const output: SessionMenuAction[] = [];
  const seen = new Set<SessionMenuAction>();

  for (const entry of order) {
    if (!isSessionMenuAction(entry) || !checkedSet.has(entry) || seen.has(entry)) {
      continue;
    }
    seen.add(entry);
    output.push(entry);
  }

  return output;
}

export function normalizeMainSessionActions(actions: string[]): SessionMenuAction[] {
  const seen = new Set<SessionMenuAction>();
  const output: SessionMenuAction[] = [];

  for (const entry of actions) {
    if (!isSessionMenuAction(entry) || seen.has(entry)) {
      continue;
    }
    seen.add(entry);
    output.push(entry);
  }

  return output;
}

export function commandForSessionMenuAction(action: SessionMenuAction): string {
  return COMMAND_BY_ACTION[action];
}

function isSessionMenuAction(value: string): value is SessionMenuAction {
  return ALL_SESSION_MENU_ACTIONS.includes(value as SessionMenuAction);
}

function normalizeSessionItemOrder(order: string[]): SessionMenuAction[] {
  const seen = new Set<SessionMenuAction>();
  const output: SessionMenuAction[] = [];

  for (const entry of order) {
    if (!isSessionMenuAction(entry) || seen.has(entry)) {
      continue;
    }
    seen.add(entry);
    output.push(entry);
  }

  for (const action of ALL_SESSION_MENU_ACTIONS) {
    if (!seen.has(action)) {
      output.push(action);
    }
  }

  return output;
}

function contextKey(action: SessionMenuAction): string {
  return `agentResume.sessionMenu.main.${action}`;
}

function mainSlotKey(slot: number): string {
  return `agentResume.sessionMenu.at${slot}`;
}

function moreSlotKey(slot: number): string {
  return `agentResume.sessionMenu.moreAt${slot}`;
}