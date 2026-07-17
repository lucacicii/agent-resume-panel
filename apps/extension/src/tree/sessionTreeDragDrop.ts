import * as vscode from "vscode";
import { moveSection, saveSectionOrder, SectionKind } from "./sectionOrder";
import { isSectionRoot, SessionTreeProvider, TreeNode } from "./sessionTree";

const MIME_TYPE = "application/vnd.code.tree.agentResume.sessions";

export class SessionTreeDragDrop implements vscode.TreeDragAndDropController<TreeNode> {
  readonly dropMimeTypes = [MIME_TYPE];
  readonly dragMimeTypes = [MIME_TYPE];

  constructor(
    private readonly tree: SessionTreeProvider,
    private readonly context: vscode.ExtensionContext
  ) {}

  handleDrag(
    source: readonly TreeNode[],
    dataTransfer: vscode.DataTransfer,
    _token: vscode.CancellationToken
  ): void {
    const node = source[0];
    if (!node || !isSectionRoot(node)) {
      return;
    }

    dataTransfer.set(MIME_TYPE, new vscode.DataTransferItem(node.kind));
  }

  async handleDrop(
    target: TreeNode | undefined,
    dataTransfer: vscode.DataTransfer,
    _token: vscode.CancellationToken
  ): Promise<void> {
    if (!target || !isSectionRoot(target)) {
      return;
    }

    const transferItem = dataTransfer.get(MIME_TYPE);
    const sourceKind = transferItem?.value;
    if (!isSectionKindValue(sourceKind) || sourceKind === target.kind) {
      return;
    }

    const next = moveSection(this.tree.getSectionOrder(), sourceKind, target.kind);
    await saveSectionOrder(this.context, next);
    this.tree.setSectionOrder(next);
  }
}

function isSectionKindValue(value: unknown): value is SectionKind {
  return value === "recentRoot" || value === "favoritesRoot" || value === "projectsRoot";
}