export const UI_LANGUAGE_SETTING = "uiLanguage";

export const UI_LANGUAGE_AUTO = "auto" as const;

export const UI_LOCALES = ["en", "zh-cn", "ja"] as const;

export type UiLocale = (typeof UI_LOCALES)[number];

export type UiLanguagePreference = typeof UI_LANGUAGE_AUTO | UiLocale;

export const UI_LANGUAGE_OPTIONS: UiLanguagePreference[] = [UI_LANGUAGE_AUTO, ...UI_LOCALES];

/** Endonyms for UI language picker — always shown in the language itself, never translated. */
export const NATIVE_LOCALE_LABELS: Record<UiLocale, string> = {
  en: "English",
  "zh-cn": "简体中文",
  ja: "日本語"
};

export const SYSTEM_LOCALE_MAP: Record<string, UiLocale> = {
  en: "en",
  "en-us": "en",
  "en-gb": "en",
  "zh-cn": "zh-cn",
  "zh-tw": "zh-cn",
  "zh-hk": "zh-cn",
  ja: "ja"
};

export function normalizeSystemLocale(language: string | undefined): UiLocale {
  const normalized = language?.trim().toLowerCase() ?? "en";
  return SYSTEM_LOCALE_MAP[normalized] ?? "en";
}

/** @deprecated Use normalizeSystemLocale */
export function normalizeVsCodeLocale(language: string | undefined): UiLocale {
  return normalizeSystemLocale(language);
}

export function isUiLocale(value: string): value is UiLocale {
  return (UI_LOCALES as readonly string[]).includes(value);
}

export function normalizeUiLanguagePreference(value: string | undefined): UiLanguagePreference {
  const trimmed = value?.trim();
  if (!trimmed || trimmed === UI_LANGUAGE_AUTO) {
    return UI_LANGUAGE_AUTO;
  }
  if (isUiLocale(trimmed)) {
    return trimmed;
  }
  return UI_LANGUAGE_AUTO;
}