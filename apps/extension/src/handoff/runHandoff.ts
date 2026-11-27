import * as vscode from "vscode";
import { AcpChatManager } from "../acp/acpChatManager";
import { t } from "../i18n";
import { getLlmConfig, readAgentResumeSetting } from "../llm/config";
import { loadAcpHandoffContext } from "./acpContextLoader";
import { buildFallbackBrief, composeHandoffMessage } from "./briefComposer";
import { loadCliHandoffContext } from "./contextLoader";
import { writeHandoffFile } from "./delivery/handoffFileWriter";
import { getHandoffDeliverer } from "./delivery/registry";
import { generateHandoffBrief } from "./generator";
import { resolveDeliveryChannelForSource } from "./targets";
import {
  HandoffBrief,
  HandoffResult,
  HandoffSource,
  HandoffTargetProvider,
  RunHandoffOptions
} from "./types";

interface RunHandoffDeps {
  context: vscode.ExtensionContext;
  acpChatManager: AcpChatManager;
}

export async function runHandoff(
  source: HandoffSource,
  targetProvider: HandoffTargetProvider,
  deps: RunHandoffDeps,
  options: RunHandoffOptions
): Promise<HandoffResult> {
  const llmConfig = await getLlmConfig(deps.context);
  if (!llmConfig) {
    throw new Error(t("error.handoffLlmNotConfigured"));
  }

  const handoffContext =
    source.kind === "cli"
      ? await loadCliHandoffContext(source.session)
      : await loadAcpHandoffContext(source.record, options.panelHome);

  const maxBriefTokens = readAgentResumeSetting("handoff.maxBriefTokens", 4000);
  const configuredVerbatim = readAgentResumeSetting("handoff.attachRecentVerbatim", 5);

  let brief: HandoffBrief;
  let briefFailure: string | undefined;
  try {
    brief = await generateHandoffBrief(handoffContext, llmConfig, maxBriefTokens);
  } catch (error) {
    briefFailure = error instanceof Error ? error.message : String(error);
    brief = buildFallbackBrief(briefFailure);
  }

  const composedMessage = composeHandoffMessage({
    brief,
    context: handoffContext,
    // Without the summary the verbatim tail is the only remaining context.
    attachRecentVerbatim: briefFailure ? Math.max(configuredVerbatim, 12) : configuredVerbatim
  });

  if (briefFailure) {
    vscode.window.showWarningMessage(t("notification.handoffBriefFallback", briefFailure));
  }

  const projectPath =
    source.kind === "cli" ? source.session.projectPath : source.record.projectPath;

  const channel = options.deliveryChannel ?? resolveDeliveryChannelForSource(source, targetProvider);

  const deliverer = getHandoffDeliverer(channel);
  if (!deliverer) {
    throw new Error(t("error.handoffUnsupportedChannel", channel));
  }

  const deliveryInput = {
    source,
    targetProvider,
    projectPath,
    composedMessage,
    handoffFilePath:
      channel === "cli"
        ? await writeHandoffFile(
            options.panelHome,
            handoffContext.sourceProvider,
            handoffContext.sessionId,
            composedMessage
          )
        : undefined
  };

  if (!deliverer.canDeliver(deliveryInput)) {
    const fallbackDeliverer = getHandoffDeliverer("clipboard");
    if (!fallbackDeliverer) {
      throw new Error(t("error.handoffCannotDeliver", targetProvider, channel));
    }
    const delivery = await fallbackDeliverer.deliver(deliveryInput, {
      acpChatManager: deps.acpChatManager,
      panelHome: options.panelHome,
      extensionContext: deps.context
    });
    return { targetProvider, delivery, composedMessage };
  }

  try {
    const delivery = await deliverer.deliver(deliveryInput, {
      acpChatManager: deps.acpChatManager,
      panelHome: options.panelHome,
      extensionContext: deps.context
    });
    return { targetProvider, delivery, composedMessage };
  } catch (error) {
    if (channel === "clipboard") {
      throw error;
    }

    const clipboard = getHandoffDeliverer("clipboard");
    if (!clipboard) {
      throw error;
    }

    vscode.window.showWarningMessage(t("notification.handoffDeliveryFallback", channel));
    const delivery = await clipboard.deliver(deliveryInput, {
      acpChatManager: deps.acpChatManager,
      panelHome: options.panelHome,
      extensionContext: deps.context
    });
    return { targetProvider, delivery, composedMessage };
  }
}
