import * as vscode from "vscode";
import { AgentProvider, AgentSession } from "../history/types";
import { SessionTreeProvider } from "../tree/sessionTree";
import { loadCatalogSettings } from "./config";
import { querySessionById } from "./query";

export async function resolveSessionById(
  tree: SessionTreeProvider,
  provider: AgentProvider,
  id: string,
  config: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration("agentResume")
): Promise<AgentSession | undefined> {
  const fromTree = tree.getSessions().find((entry) => entry.provider === provider && entry.id === id);
  if (fromTree) {
    return fromTree;
  }

  const catalog = loadCatalogSettings(config);
  return querySessionById(catalog.dbPath, provider, id);
}