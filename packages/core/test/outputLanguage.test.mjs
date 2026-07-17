import assert from "node:assert/strict";
import {
  normalizeOutputLanguagePreference,
  resolveEffectiveOutputLanguage,
  normalizeSummaryLanguageTag,
  summaryLanguagesMatch,
  OUTPUT_LANGUAGE_AUTO
} from "../dist/i18n/outputLanguage.js";

assert.equal(normalizeOutputLanguagePreference("auto"), OUTPUT_LANGUAGE_AUTO);
assert.equal(normalizeOutputLanguagePreference("English"), "en");
assert.equal(normalizeOutputLanguagePreference("zh-CN"), "zh-cn");
assert.equal(normalizeOutputLanguagePreference(undefined), OUTPUT_LANGUAGE_AUTO);

const englishDefault = resolveEffectiveOutputLanguage({
  outputPreference: "auto",
  uiPreference: "en",
  systemLocale: "en-US"
});
assert.equal(englishDefault.catalogLanguage, "English");

const followsUi = resolveEffectiveOutputLanguage({
  outputPreference: "auto",
  uiPreference: "zh-cn",
  systemLocale: "en-US"
});
assert.equal(followsUi.catalogLanguage, "Chinese");

const explicit = resolveEffectiveOutputLanguage({
  outputPreference: "ja",
  uiPreference: "zh-cn",
  systemLocale: "en-US"
});
assert.equal(explicit.catalogLanguage, "Japanese");

assert.equal(normalizeSummaryLanguageTag("zh-CN"), "Chinese");
assert.equal(normalizeSummaryLanguageTag("English"), "English");
assert.ok(summaryLanguagesMatch("zh-CN", "Chinese"));
assert.ok(summaryLanguagesMatch("English", "en"));

console.log("outputLanguage.test.mjs: ok");