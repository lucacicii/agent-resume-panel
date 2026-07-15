import {
  normalizeSystemLocale,
  normalizeUiLanguagePreference,
  UI_LANGUAGE_AUTO,
  UiLanguagePreference,
  UiLocale
} from "./locales";

export function resolveUiLocale(
  preference: UiLanguagePreference | string | undefined,
  systemLocale: string | undefined
): UiLocale {
  const pref = normalizeUiLanguagePreference(preference);
  if (pref !== UI_LANGUAGE_AUTO) {
    return pref;
  }
  return normalizeSystemLocale(systemLocale);
}