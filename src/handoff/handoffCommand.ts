import * as vscode from "vscode";
import { AcpChatManager } from "../acp/acpChatManager";
import { AcpChatTreeProvider } from "../acp/acpChatTree";
import { AcpSessionRecord } from "../acp/types";
import { panelHomeFromConfig } from "../acp/config";
import { AgentSession } from "../history";
import { SessionTreeProvider } from "../tree/sessionTree";
import { ensureLlmConfigured } from "../preview/sessionAssistActions";
import { HandoffSource, HandoffTargetProvider } from "./types";
import { runHandoff } from "./runHandoff";
import { HANDOFF_TARGET_META, CLI_HANDOFF_TARGETS } from "./targets";
import { pickHandoffTargetForPreview } from "./previewTargetPicker";

export interface HandoffCommandArg {
  target?: HandoffTargetProvider;
}

export async function executeHandoffCommand(
  nodeOrSource: unknown,
  arg: HandoffCommandArg | undefined,
  deps: {
    context: vscode.ExtensionContext;
    acpChatManager: AcpChatManager;
    sessionTree?: SessionTreeProvider;
    acpTree?: AcpChatTreeProvider;
  }
): Promise<void> {
  if (!(await ensureLlmConfigured(deps.context))) {
    return;
  }

  const source = resolveHandoffSource(nodeOrSource, deps);
  if (!source) {
    vscode.window.showWarningMessage("Could not resolve a session to hand off.");
    return;
  }

  let target = normalizeHandoffTarget(arg?.target);
  if (!target) {
    const sourceProvider =
      source.kind === "cli" ? source.session.provider : source.record.provider;
    target = await pickHandoffTargetForPreview(sourceProvider, source.kind);
    if (!target) {
      return;
    }
  }

  if (isSameProvider(source, target)) {
    vscode.window.showWarningMessage("Cannot hand off a session to the same agent.");
    return;
  }

  const targetLabel = HANDOFF_TARGET_META[target].label;

  try {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Handing off to ${targetLabel}…`,
        cancellable: false
      },
      async () => {
        const result = await runHandoff(
          source,
          target!,
          {
            context: deps.context,
            acpChatManager: deps.acpChatManager
          },
          {
            panelHome: panelHomeFromConfig()
          }
        );

        const channelLabel =
          result.delivery.channel === "acp"
            ? "ACP Chat"
            : result.delivery.channel === "cli"
              ? "CLI terminal"
              : "clipboard";

        vscode.window.showInformationMessage(`Session handed off to ${targetLabel} via ${channelLabel}.`);
      }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorMessage !== "Handoff cancelled.") {
      vscode.window.showErrorMessage(`Handoff failed: ${errorMessage}`);
    }
    throw error;
  }
}

function resolveHandoffSource(
  nodeOrSource: unknown,
  deps: {
    sessionTree?: SessionTreeProvider;
    acpTree?: AcpChatTreeProvider;
  }
): HandoffSource | undefined {
  if (isHandoffSource(nodeOrSource)) {
    return nodeOrSource;
  }

  if (deps.sessionTree) {
    const session = deps.sessionTree.getSessionFromNode(nodeOrSource);
    if (session && session.provider !== "chat" && session.provider !== "alma") {
      return { kind: "cli", session };
    }
  }

  if (deps.sessionTree && isAgentSession(nodeOrSource)) {
    if (nodeOrSource.provider === "chat" || nodeOrSource.provider === "alma") {
      return undefined;
    }
    return { kind: "cli", session: nodeOrSource };
  }

  if (deps.acpTree) {
    const record = deps.acpTree.getRecordFromNode(nodeOrSource);
    if (record) {
      return { kind: "acp", record };
    }
  }

  if (isAcpSessionRecord(nodeOrSource)) {
    return { kind: "acp", record: nodeOrSource };
  }

  return undefined;
}

function isAcpSessionRecord(value: unknown): value is AcpSessionRecord {
  return Boolean(
    value &&
      typeof value === "object" &&
      "provider" in value &&
      "projectPath" in value &&
      "id" in value &&
      !("kind" in value)
  );
}

function isHandoffSource(value: unknown): value is HandoffSource {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as { kind?: string };
  return record.kind === "cli" || record.kind === "acp";
}

function isAgentSession(value: unknown): value is AgentSession {
  return Boolean(
    value &&
      typeof value === "object" &&
      "provider" in value &&
      "id" in value &&
      "projectPath" in value
  );
}

function normalizeHandoffTarget(value: unknown): HandoffTargetProvider | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  return CLI_HANDOFF_TARGETS.find((provider) => provider === value);
}

function isSameProvider(source: HandoffSource, target: HandoffTargetProvider): boolean {
  const sourceProvider = source.kind === "cli" ? source.session.provider : source.record.provider;
  return sourceProvider === target;
}