import {
  isUiLocale,
  normalizeUiLanguagePreference,
  UI_LOCALES,
  UiLocale
} from "./locales";
import { resolveUiLocale } from "./resolve";

export const OUTPUT_LANGUAGE_AUTO = "auto" as const;

export const OUTPUT_LANGUAGE_OPTIONS = ["auto", ...UI_LOCALES] as const;

export type OutputLanguagePreference = (typeof OUTPUT_LANGUAGE_OPTIONS)[number];

export const DEFAULT_CATALOG_OUTPUT_LANGUAGE = "English";

const UI_LOCALE_TO_CATALOG_LANGUAGE: Record<UiLocale, string> = {
  en: "English",
  "zh-cn": "Chinese",
  ja: "Japanese",
  ko: "Korean",
  es: "Spanish",
  fr: "French",
  de: "German",
  "pt-br": "Portuguese",
  it: "Italian",
  ru: "Russian"
};

const LEGACY_CATALOG_TO_LOCALE: Record<string, UiLocale> = {
  English: "en",
  Chinese: "zh-cn",
  Japanese: "ja",
  Korean: "ko",
  Spanish: "es",
  French: "fr",
  German: "de",
  Portuguese: "pt-br",
  Italian: "it",
  Russian: "ru"
};

const LEGACY_LOCALE_ALIASES: Record<string, UiLocale> = {
  en: "en",
  "en-us": "en",
  "en-gb": "en",
  "zh-cn": "zh-cn",
  "zh_cn": "zh-cn",
  zh: "zh-cn",
  "zh-tw": "zh-cn",
  "zh-hk": "zh-cn",
  ja: "ja",
  ko: "ko",
  es: "es",
  fr: "fr",
  de: "de",
  "pt-br": "pt-br",
  pt: "pt-br",
  it: "it",
  ru: "ru"
};

export interface EffectiveOutputLanguage {
  preference: OutputLanguagePreference;
  locale: UiLocale;
  catalogLanguage: string;
  promptLanguage: string;
}

function legacyCatalogToLocale(value: string): UiLocale | undefined {
  const direct = LEGACY_CATALOG_TO_LOCALE[value];
  if (direct) {
    return direct;
  }
  const lower = value.toLowerCase();
  for (const [name, locale] of Object.entries(LEGACY_CATALOG_TO_LOCALE)) {
    if (name.toLowerCase() === lower) {
      return locale;
    }
  }
  return undefined;
}

export function normalizeOutputLanguagePreference(value: string | undefined): OutputLanguagePreference {
  const trimmed = value?.trim();
  if (!trimmed || trimmed === OUTPUT_LANGUAGE_AUTO) {
    return OUTPUT_LANGUAGE_AUTO;
  }
  if (isUiLocale(trimmed)) {
    return trimmed;
  }
  const alias = LEGACY_LOCALE_ALIASES[trimmed.toLowerCase()];
  if (alias) {
    return alias;
  }
  const fromCatalog = legacyCatalogToLocale(trimmed);
  if (fromCatalog) {
    return fromCatalog;
  }
  return OUTPUT_LANGUAGE_AUTO;
}

export function catalogLanguageForLocale(locale: UiLocale): string {
  return UI_LOCALE_TO_CATALOG_LANGUAGE[locale] ?? DEFAULT_CATALOG_OUTPUT_LANGUAGE;
}

export function resolveEffectiveOutputLanguage(input: {
  outputPreference?: string;
  uiPreference?: string;
  systemLocale?: string;
}): EffectiveOutputLanguage {
  const preference = normalizeOutputLanguagePreference(input.outputPreference);
  const uiPref = normalizeUiLanguagePreference(input.uiPreference);
  const locale =
    preference === OUTPUT_LANGUAGE_AUTO
      ? resolveUiLocale(uiPref, input.systemLocale)
      : preference;
  const catalogLanguage = catalogLanguageForLocale(locale);
  return {
    preference,
    locale,
    catalogLanguage,
    promptLanguage: catalogLanguage
  };
}

export function normalizeSummaryLanguageTag(tag: string | null | undefined): string {
  const trimmed = tag?.trim();
  if (!trimmed) {
    return "";
  }
  const directCatalog = LEGACY_CATALOG_TO_LOCALE[trimmed];
  if (directCatalog) {
    return catalogLanguageForLocale(directCatalog);
  }
  const lower = trimmed.toLowerCase();
  for (const [name, locale] of Object.entries(LEGACY_CATALOG_TO_LOCALE)) {
    if (name.toLowerCase() === lower) {
      return catalogLanguageForLocale(locale);
    }
  }
  const pref = normalizeOutputLanguagePreference(trimmed);
  if (pref === OUTPUT_LANGUAGE_AUTO) {
    return DEFAULT_CATALOG_OUTPUT_LANGUAGE;
  }
  return catalogLanguageForLocale(pref);
}

export function summaryLanguagesMatch(
  stored: string | null | undefined,
  effective: string | null | undefined
): boolean {
  const left = normalizeSummaryLanguageTag(stored);
  const right = normalizeSummaryLanguageTag(effective);
  return Boolean(left && right && left === right);
}