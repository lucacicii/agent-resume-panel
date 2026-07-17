import * as vscode from "vscode";
import { t } from "../../i18n";
import { HandoffDeliverer } from "./types";

export const clipboardHandoffDeliverer: HandoffDeliverer = {
  channel: "clipboard",

  canDeliver() {
    return true;
  },

  async deliver(input) {
    await vscode.env.clipboard.writeText(input.composedMessage);
    vscode.window.showInformationMessage(t("notification.handoffCopiedToClipboard"));
    return { channel: "clipboard" };
  }
};