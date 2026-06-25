import * as path from "node:path";
import * as vscode from "vscode";
import { AgentSession, basenameOrPath, compactPath } from "../history";
import { isFavoriteProject } from "../favorites/projectFavorites";
import { openSessionResume } from "../terminal/resumeTerminal";
import { buildProjectList, sessionQuickPickLabel, SessionTreeProvider } from "../tree/sessionTree";

type SearchPickItem = vscode.QuickPickItem & {
  pickKind: "project" | "session" | "empty" | "separator";
  projectPath?: string;
  session?: AgentSession;
};

export async function searchAndOpenSessions(tree: SessionTreeProvider): Promise<void> {
  const sessions = tree.getSessions();
  const favoriteProjects = tree.getFavoriteProjects();
  const projects = buildProjectList(sessions, favoriteProjects);

  const quickPick = vscode.window.createQuickPick<SearchPickItem>();
  let selectedProjectPath: string | undefined;
  let query = "";

  quickPick.title = "Resume Agent Session";
  quickPick.placeholder = "Select a project shortcut, then search sessions";
  quickPick.matchOnDescription = false;
  quickPick.matchOnDetail = false;

  const updateView = (): void => {
    quickPick.title = selectedProjectPath
      ? `Resume Agent Session — ${basenameOrPath(selectedProjectPath)}`
      : "Resume Agent Session";
    quickPick.buttons = selectedProjectPath
      ? [{ iconPath: new vscode.ThemeIcon("close"), tooltip: "Clear project filter" }]
      : [];
    quickPick.placeholder = selectedProjectPath
      ? `Search sessions in ${basenameOrPath(selectedProjectPath)}`
      : "Select a project shortcut, then search sessions";
    quickPick.items = buildItems(sessions, projects, favoriteProjects, selectedProjectPath, query);
  };

  quickPick.onDidChangeValue((value) => {
    query = value;
    updateView();
  });

  quickPick.onDidTriggerButton(() => {
    selectedProjectPath = undefined;
    query = quickPick.value;
    updateView();
  });

  quickPick.onDidAccept(() => {
    const picked = quickPick.selectedItems[0];
    if (!picked) {
      return;
    }

    if (picked.pickKind === "empty" || picked.pickKind === "separator") {
      return;
    }

    if (picked.pickKind === "project") {
      selectedProjectPath = picked.projectPath;
      query = quickPick.value;
      updateView();
      return;
    }

    if (!picked.session) {
      return;
    }

    quickPick.hide();
    openSessionResume(picked.session, undefined);
  });

  quickPick.onDidHide(() => quickPick.dispose());

  updateView();
  quickPick.show();
}

function buildItems(
  sessions: AgentSession[],
  projects: ReturnType<typeof buildProjectList>,
  favoriteProjects: string[],
  selectedProjectPath: string | undefined,
  query: string
): SearchPickItem[] {
  const items: SearchPickItem[] = [
    {
      label: "Projects",
      kind: vscode.QuickPickItemKind.Separator,
      pickKind: "separator"
    },
    projectItem("All Projects", undefined, sessions.length, !selectedProjectPath)
  ];

  for (const project of projects) {
    const starred = isFavoriteProject(favoriteProjects, project.projectPath);
    const label = starred
      ? `$(star-full) ${basenameOrPath(project.projectPath)}`
      : `$(folder) ${basenameOrPath(project.projectPath)}`;
    items.push(
      projectItem(
        label,
        project.projectPath,
        project.sessions.length,
        selectedProjectPath === project.projectPath,
        compactPath(project.projectPath)
      )
    );
  }

  const filteredSessions = sessions.filter((session) => matchesSession(session, query, selectedProjectPath));

  items.push({
    label: selectedProjectPath ? "Sessions in project" : "Sessions",
    kind: vscode.QuickPickItemKind.Separator,
    pickKind: "separator"
  });

  if (!filteredSessions.length) {
    items.push({
      label: selectedProjectPath ? "No sessions match in this project" : "No sessions match",
      pickKind: "empty",
      alwaysShow: true,
      description: query ? "Try a different search" : undefined
    });
    return items;
  }

  for (const session of filteredSessions) {
    const pick = sessionQuickPickLabel(session, { omitProjectPath: Boolean(selectedProjectPath) });
    items.push({
      ...pick,
      pickKind: "session",
      session
    });
  }

  return items;
}

function projectItem(
  label: string,
  projectPath: string | undefined,
  sessionCount: number,
  selected: boolean,
  detail?: string
): SearchPickItem {
  const prefix = selected ? "$(check) " : "";
  return {
    label: `${prefix}${label}`,
    description: `${sessionCount}`,
    detail,
    pickKind: "project",
    projectPath,
    alwaysShow: true
  };
}

function matchesSession(session: AgentSession, query: string, selectedProjectPath?: string): boolean {
  const normalizedProject = path.resolve(session.projectPath || process.env.HOME || "");
  if (selectedProjectPath && normalizedProject !== selectedProjectPath) {
    return false;
  }

  const trimmed = query.trim().toLowerCase();
  if (!trimmed) {
    return true;
  }

  return (
    session.title.toLowerCase().includes(trimmed) ||
    session.provider.toLowerCase().includes(trimmed) ||
    (session.branch?.toLowerCase().includes(trimmed) ?? false) ||
    (!selectedProjectPath && compactPath(session.projectPath).toLowerCase().includes(trimmed))
  );
}