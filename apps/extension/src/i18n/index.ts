import * as path from "node:path";
import * as vscode from "vscode";
import {
  getCatalogForLocale,
  loadCatalogs,
  NATIVE_LOCALE_LABELS,
  normalizeUiLanguagePreference,
  resetI18nCache,
  resolveUiLocale as coreResolveUiLocale,
  setLocalesDir,
  translateKey,
  UI_LANGUAGE_AUTO,
  UI_LANGUAGE_SETTING,
  OUTPUT_LANGUAGE_AUTO,
  OUTPUT_LANGUAGE_OPTIONS,
  UiLocale,
  isUiLocale,
  normalizeOutputLanguagePreference
} from "@agent-resume/core/extension";
import { readAgentResumeSetting } from "../llm/config";

function getExtensionRoot(): string {
  return path.join(__dirname, "..", "..");
}

function ensureCatalogsLoaded(): void {
  setLocalesDir(path.join(getExtensionRoot(), "locales"));
  loadCatalogs();
}

export function resolveUiLocaleForExtension(): UiLocale {
  ensureCatalogsLoaded();
  const pref = normalizeUiLanguagePreference(readAgentResumeSetting(UI_LANGUAGE_SETTING, UI_LANGUAGE_AUTO));
  return coreResolveUiLocale(pref, vscode.env.language);
}

export function t(key: string, ...args: (string | number)[]): string {
  ensureCatalogsLoaded();
  return translateKey(resolveUiLocaleForExtension(), key, args);
}

export function getUiLocaleDisplayName(locale: UiLocale): string {
  return NATIVE_LOCALE_LABELS[locale];
}

export function getUiLanguageOptionLabel(preference: string): string {
  if (preference === UI_LANGUAGE_AUTO) {
    return t("settings.fieldUiLanguageOptionAuto");
  }
  if (isUiLocale(preference)) {
    return NATIVE_LOCALE_LABELS[preference];
  }
  return preference;
}

export function getOutputLanguageOptionLabel(preference: string): string {
  if (preference === OUTPUT_LANGUAGE_AUTO) {
    return t("settings.fieldLlmOutputLanguageOptionAuto");
  }
  if (isUiLocale(preference)) {
    return NATIVE_LOCALE_LABELS[preference];
  }
  return preference;
}

export { resetI18nCache };

/** @deprecated Use resolveUiLocaleForExtension */
export function resolveUiLocale(): UiLocale {
  return resolveUiLocaleForExtension();
}

export { getCatalogForLocale };
