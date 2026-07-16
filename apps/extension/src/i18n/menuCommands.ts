import * as vscode from "vscode";
import { UI_LOCALES, UiLocale } from "./locales";

export function localizedMenuCommandId(baseCommand: string, locale: UiLocale): string {
  if (locale === "en") {
    return baseCommand;
  }
  const prefix = "agentResume.";
  if (!baseCommand.startsWith(prefix)) {
    return baseCommand;
  }
  return `${prefix}${locale}.${baseCommand.slice(prefix.length)}`;
}

export function menuCommand(
  baseCommand: string,
  handler: (...args: unknown[]) => unknown
): vscode.Disposable[] {
  return UI_LOCALES.map((locale) =>
    vscode.commands.registerCommand(localizedMenuCommandId(baseCommand, locale), handler)
  );
}