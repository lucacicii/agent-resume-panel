import * as vscode from "vscode";
import { t } from "../i18n";
import { buildProjectFilterScope, ProjectFilterScope } from "./projectFilter";

const STORAGE_KEY = "agentResume.filterCurrentProject";
export const CURRENT_PROJECT_FILTER_CONTEXT = "agentResume.currentProjectFilter.enabled";

export class CurrentProjectFilterController implements vscode.Disposable {
  private readonly onDidChangeEmitter = new vscode.EventEmitter<boolean>();
  readonly onDidChange = this.onDidChangeEmitter.event;

  private enabled: boolean;
  private readonly workspaceListener: vscode.Disposable;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.enabled = Boolean(context.workspaceState.get<boolean>(STORAGE_KEY, false));
    this.workspaceListener = vscode.workspace.onDidChangeWorkspaceFolders(() => {
      if (this.enabled) {
        this.onDidChangeEmitter.fire(this.enabled);
      }
    });
  }

  async initialize(): Promise<void> {
    await vscode.commands.executeCommand("setContext", CURRENT_PROJECT_FILTER_CONTEXT, this.enabled);
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  getWorkspaceRoots(): string[] {
    return (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri.fsPath);
  }

  getActiveScope(): ProjectFilterScope | undefined {
    if (!this.enabled) {
      return undefined;
    }
    return buildProjectFilterScope(this.getWorkspaceRoots());
  }

  getDescriptionLabel(): string | undefined {
    if (!this.enabled) {
      return undefined;
    }
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (folders.length === 0) {
      return t("tree.currentProjectFilter.noWorkspace");
    }
    if (folders.length === 1) {
      return t("tree.currentProjectFilter.activeSingle", folders[0].name);
    }
    return t("tree.currentProjectFilter.activeMulti", folders.length);
  }

  async setEnabled(next: boolean): Promise<void> {
    const normalized = Boolean(next);
    if (this.enabled === normalized) {
      await vscode.commands.executeCommand("setContext", CURRENT_PROJECT_FILTER_CONTEXT, this.enabled);
      return;
    }
    this.enabled = normalized;
    await this.context.workspaceState.update(STORAGE_KEY, normalized);
    await vscode.commands.executeCommand("setContext", CURRENT_PROJECT_FILTER_CONTEXT, normalized);
    this.onDidChangeEmitter.fire(normalized);
  }

  async toggle(): Promise<boolean> {
    const next = !this.enabled;
    await this.setEnabled(next);
    return next;
  }

  dispose(): void {
    this.workspaceListener.dispose();
    this.onDidChangeEmitter.dispose();
  }
}
