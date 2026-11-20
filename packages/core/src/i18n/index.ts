export {
  UI_LANGUAGE_SETTING,
  UI_LANGUAGE_AUTO,
  UI_LOCALES,
  UI_LANGUAGE_OPTIONS,
  NATIVE_LOCALE_LABELS,
  SYSTEM_LOCALE_MAP,
  normalizeSystemLocale,
  normalizeVsCodeLocale,
  isUiLocale,
  normalizeUiLanguagePreference
} from "./locales";
export type { UiLocale, UiLanguagePreference } from "./locales";
export {
  loadCatalogs,
  setLocalesDir,
  getLocalesDir,
  translateKey,
  getCatalogForLocale,
  interpolate,
  resetI18nCache
} from "./catalog";
export type { MessageCatalog } from "./catalog";
export { resolveUiLocale } from "./resolve";
export {
  OUTPUT_LANGUAGE_AUTO,
  OUTPUT_LANGUAGE_OPTIONS,
  DEFAULT_CATALOG_OUTPUT_LANGUAGE,
  normalizeOutputLanguagePreference,
  catalogLanguageForLocale,
  resolveEffectiveOutputLanguage,
  normalizeSummaryLanguageTag,
  summaryLanguagesMatch
} from "./outputLanguage";
export type { OutputLanguagePreference, EffectiveOutputLanguage } from "./outputLanguage";