import * as vscode from "vscode";
import { HandoffDeliverer } from "./types";

export const clipboardHandoffDeliverer: HandoffDeliverer = {
  channel: "clipboard",

  canDeliver() {
    return true;
  },

  async deliver(input) {
    await vscode.env.clipboard.writeText(input.composedMessage);
    vscode.window.showInformationMessage("Handoff brief copied to clipboard.");
    return { channel: "clipboard" };
  }
};