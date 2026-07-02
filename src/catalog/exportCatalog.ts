import * as path from "node:path";
import * as vscode from "vscode";
import { loadCatalogSettings } from "./config";
import { exportCatalogWithTranscripts } from "./transcript/export";

export async function exportCatalogCommand(syncFirst: () => Promise<void>): Promise<void> {
  const catalog = loadCatalogSettings();
  const folder = await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: "Select export folder"
  });

  if (!folder?.[0]) {
    return;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outputDir = path.join(folder[0].fsPath, `agent-resume-catalog-${stamp}`);

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Exporting catalog with transcripts...",
      cancellable: false
    },
    async () => {
      await syncFirst();
      const result = await exportCatalogWithTranscripts({
        dbPath: catalog.dbPath,
        outputDir
      });

      const summary = `Exported ${result.sessionCount} session(s), ${result.transcriptFileCount} transcript file(s).`;
      if (result.warnings.length) {
        const preview = result.warnings.slice(0, 3).join(" ");
        const more = result.warnings.length > 3 ? ` (+${result.warnings.length - 3} more)` : "";
        vscode.window.showWarningMessage(`${summary} ${preview}${more}`, "Open folder").then((choice) => {
          if (choice === "Open folder") {
            void vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(result.outputDir));
          }
        });
        return;
      }

      const open = await vscode.window.showInformationMessage(summary, "Open folder");
      if (open === "Open folder") {
        void vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(result.outputDir));
      }
    }
  );
}