import * as vscode from "vscode";
import { AcpChatPanel } from "./acpChatPanel";
import { AcpSessionRecord } from "./types";

export class AcpChatManager {
  private readonly panels = new Map<string, AcpChatPanel>();

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly reloadTree: () => Promise<void>
  ) {}

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

  dispose(): void {
    for (const panel of this.panels.values()) {
      panel.dispose();
    }
    this.panels.clear();
  }
}