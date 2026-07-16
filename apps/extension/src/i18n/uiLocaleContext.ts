import * as vscode from "vscode";
import { resolveUiLocale } from "./index";

const UI_LOCALE_CONTEXT = "agentResume.uiLocale";

export async function applyUiLocaleContext(): Promise<void> {
  const locale = resolveUiLocale();
  await vscode.commands.executeCommand("setContext", UI_LOCALE_CONTEXT, locale);
}