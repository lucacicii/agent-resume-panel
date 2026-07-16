import * as vscode from "vscode";
import { AgentProvider } from "../../history";
import { HandoffDeliverer } from "./types";
import { writeHandoffFile } from "./handoffFileWriter";
import { buildHandoffCliLaunchCommand } from "./cliLaunch";

export const cliHandoffDeliverer: HandoffDeliverer = {
  channel: "cli",

  canDeliver() {
    return true;
  },

  async deliver(input, deps) {
    const filePath =
      input.handoffFilePath ??
      (await writeHandoffFile(
        deps.panelHome,
        input.source.kind === "cli" ? input.source.session.provider : input.source.record.provider,
        input.source.kind === "cli" ? input.source.session.id : input.source.record.id,
        input.composedMessage
      ));

    const provider = input.targetProvider as AgentProvider;
    const launchCommand = buildHandoffCliLaunchCommand(
      provider,
      input.projectPath,
      input.composedMessage,
      filePath
    );

    const terminal = vscode.window.createTerminal({
      name: `Handoff → ${providerLabel(provider)}`,
      cwd: input.projectPath || undefined,
      location: terminalLocation()
    });

    terminal.show();
    terminal.sendText(launchCommand, true);

    return {
      channel: "cli",
      detail: filePath
    };
  }
};

function terminalLocation(): vscode.TerminalOptions["location"] {
  const config = vscode.workspace.getConfiguration("agentResume");
  const configured = config.get<string>("terminalLocation", "editorBeside");
  if (configured === "panel") {
    return vscode.TerminalLocation.Panel;
  }
  return { viewColumn: vscode.ViewColumn.Beside };
}

function providerLabel(provider: AgentProvider): string {
  switch (provider) {
    case "codex":
      return "Codex";
    case "claude":
      return "Claude";
    case "agy":
      return "Antigravity";
    case "grok":
      return "Grok";
    case "opencode":
      return "OpenCode";
    case "pi":
      return "Pi";
    default:
      return provider;
  }
}