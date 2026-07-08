import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { readAgentResumeSetting } from "../llm/config";
import {
  normalizeUiLanguagePreference,
  normalizeVsCodeLocale,
  UI_LANGUAGE_AUTO,
  UI_LANGUAGE_SETTING,
  UI_LOCALES,
  UiLocale,
  isUiLocale
} from "./locales";

type MessageCatalog = Record<string, string>;

const catalogs = new Map<UiLocale, MessageCatalog>();
let catalogsLoaded = false;

function getExtensionRoot(): string {
  return path.join(__dirname, "..", "..");
}

function loadCatalogs(): void {
  if (catalogsLoaded) {
    return;
  }

  const localesDir = path.join(getExtensionRoot(), "locales");
  for (const locale of UI_LOCALES) {
    const filePath = path.join(localesDir, `${locale}.json`);
    if (!fs.existsSync(filePath)) {
      continue;
    }
    try {
      catalogs.set(locale, JSON.parse(fs.readFileSync(filePath, "utf8")) as MessageCatalog);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[agent-resume-panel] Failed to load locale file ${filePath}: ${message}`);
    }
  }

  catalogsLoaded = true;
}

export function resolveUiLocale(): UiLocale {
  loadCatalogs();
  const pref = normalizeUiLanguagePreference(readAgentResumeSetting(UI_LANGUAGE_SETTING, UI_LANGUAGE_AUTO));
  if (pref !== UI_LANGUAGE_AUTO) {
    return pref;
  }
  return normalizeVsCodeLocale(vscode.env.language);
}

function interpolate(template: string, args: (string | number)[]): string {
  return template.replace(/\{(\d+)\}/g, (_match, indexText: string) => {
    const index = Number(indexText);
    const value = args[index];
    return value === undefined ? `{${indexText}}` : String(value);
  });
}

export function t(key: string, ...args: (string | number)[]): string {
  loadCatalogs();
  const locale = resolveUiLocale();
  const template = catalogs.get(locale)?.[key] ?? catalogs.get("en")?.[key] ?? key;
  return args.length > 0 ? interpolate(template, args) : template;
}

const LOCALE_LABEL_KEYS: Record<UiLocale, string> = {
  en: "locale.en",
  "zh-cn": "locale.zh-cn",
  ja: "locale.ja",
  ko: "locale.ko",
  es: "locale.es",
  fr: "locale.fr",
  de: "locale.de",
  "pt-br": "locale.pt-br",
  it: "locale.it",
  ru: "locale.ru"
};

export function getUiLocaleDisplayName(locale: UiLocale): string {
  return t(LOCALE_LABEL_KEYS[locale]);
}

export function getUiLanguageOptionLabel(preference: string): string {
  if (preference === UI_LANGUAGE_AUTO) {
    return t("settings.fieldUiLanguageOptionAuto");
  }
  if (isUiLocale(preference)) {
    return t(LOCALE_LABEL_KEYS[preference]);
  }
  return preference;
}

/** For tests or hot-reload after editing locale files in development. */
export function resetI18nCache(): void {
  catalogs.clear();
  catalogsLoaded = false;
}