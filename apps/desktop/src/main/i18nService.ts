import { app } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  getCatalogForLocale,
  loadCatalogs,
  normalizeUiLanguagePreference,
  resolveUiLocale,
  setLocalesDir,
  translateKey,
  UI_LANGUAGE_AUTO,
  UiLocale,
  type PanelSettings,
  type UiLanguagePreference
} from "@agent-resume/core";

export interface I18nBundle {
  locale: UiLocale;
  messages: Record<string, string>;
}

let initialized = false;
let localesDir = "";

function resolveLocalesDir(appRoot: string): string {
  const distLocales = path.join(appRoot, "dist", "locales");
  if (process.env.AGENT_RESUME_DEV === "1") {
    const repoLocales = path.join(appRoot, "..", "..", "locales");
    if (fs.existsSync(repoLocales)) {
      return repoLocales;
    }
  }
  return distLocales;
}

export function initI18nService(appRoot: string): void {
  if (initialized) {
    return;
  }
  localesDir = resolveLocalesDir(appRoot);
  setLocalesDir(localesDir);
  loadCatalogs();
  initialized = true;
}

export function resolveDesktopLocale(settings: PanelSettings | undefined): UiLocale {
  const pref = normalizeUiLanguagePreference(settings?.uiLanguage ?? UI_LANGUAGE_AUTO);
  return resolveUiLocale(pref, app.getLocale());
}

export function buildI18nBundle(settings: PanelSettings | undefined): I18nBundle {
  const locale = resolveDesktopLocale(settings);
  return {
    locale,
    messages: getCatalogForLocale(locale)
  };
}

export function desktopT(
  settings: PanelSettings | undefined,
  key: string,
  ...args: (string | number)[]
): string {
  const locale = resolveDesktopLocale(settings);
  return translateKey(locale, key, args);
}

export function readUiLanguagePreference(settings: PanelSettings | undefined): UiLanguagePreference {
  return normalizeUiLanguagePreference(settings?.uiLanguage ?? UI_LANGUAGE_AUTO);
}