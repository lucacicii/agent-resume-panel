import * as vscode from "vscode";
import { AcpChatPanel } from "./acpChatPanel";
import { AcpSessionRecord } from "./types";

let activeAcpChatManager: AcpChatManager | undefined;

export class AcpChatManager {
  private readonly panels = new Map<string, AcpChatPanel>();

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly reloadTree: () => Promise<void>
  ) {
    activeAcpChatManager = this;
  }

  open(record: AcpSessionRecord, options?: { initialPrompt?: string }): void {
    const existing = this.panels.get(record.id);
    if (existing) {
      existing.reveal();
      return;
    }

    const panel = new AcpChatPanel(this.context, record, this.reloadTree, () => {
      this.panels.delete(record.id);
    }, options);
    this.panels.set(record.id, panel);
  }

  hasPanel(id: string): boolean {
    return this.panels.has(id);
  }

  refreshAllPanels(): void {
    for (const panel of this.panels.values()) {
      panel.refreshLocalizedUi();
    }
  }

  async refreshExternalStore(): Promise<void> {
    await Promise.allSettled([...this.panels.values()].map((panel) => panel.refreshExternalStore()));
  }

  dispose(): void {
    for (const panel of this.panels.values()) {
      panel.dispose();
    }
    this.panels.clear();
    if (activeAcpChatManager === this) {
      activeAcpChatManager = undefined;
    }
  }
}

export async function refreshAcpChatPanels(): Promise<void> {
  activeAcpChatManager?.refreshAllPanels();
}
