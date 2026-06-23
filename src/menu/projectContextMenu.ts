import * as vscode from "vscode";

export type ProjectMenuAction =
  | "favorite"
  | "openProject"
  | "openInGhostty"
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

const ACTION_LABELS: Record<ProjectMenuAction, string> = {
  favorite: "Add to / Remove from Favorites",
  openProject: "Open Folder and Resume",
  openInGhostty: "Open in Ghostty",
  newCodexSession: "New Codex Session",
  newClaudeSession: "New Claude Session",
  newAgySession: "New Antigravity Session",
  newGrokSession: "New Grok Session",
  newOpenCodeSession: "New OpenCode Session",
  newPiSession: "New Pi Session",
  newAlmaSession: "New Alma Thread",
  newCodexAppSession: "New Codex App Session"
};

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

export async function applyProjectMenuContext(mainActions: ProjectMenuAction[]): Promise<void> {
  const mainSet = new Set(mainActions);

  for (const action of ALL_PROJECT_MENU_ACTIONS) {
    await vscode.commands.executeCommand("setContext", contextKey(action), mainSet.has(action));
  }
}

export async function configureProjectMenu(): Promise<void> {
  const config = vscode.workspace.getConfiguration("agentResume");
  const current = new Set(loadMainActions(config));

  const items = ALL_PROJECT_MENU_ACTIONS.map((action) => ({
    label: ACTION_LABELS[action],
    description: action,
    picked: current.has(action)
  }));

  const picked = await vscode.window.showQuickPick(items, {
    title: "Customize Project Context Menu",
    placeHolder: "Open Folder is always visible. Checked items appear in the main menu; unchecked items go under Show More.",
    canPickMany: true,
    ignoreFocusOut: true
  });

  if (!picked) {
    return;
  }

  const next = picked
    .map((item) => item.description)
    .filter((value): value is ProjectMenuAction => isProjectMenuAction(value));

  await saveMainActions(config, next);
  await applyProjectMenuContext(next);
}

function normalizeMainActions(actions: string[]): ProjectMenuAction[] {
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

function contextKey(action: ProjectMenuAction): string {
  return `agentResume.projectMenu.main.${action}`;
}