export const LLM_OUTPUT_LANGUAGES = [
  "English",
  "Chinese",
  "Japanese",
  "Korean",
  "Spanish",
  "French",
  "German",
  "Portuguese",
  "Italian",
  "Russian"
] as const;

export type LlmOutputLanguage = (typeof LLM_OUTPUT_LANGUAGES)[number];

export const DEFAULT_LLM_OUTPUT_LANGUAGE: LlmOutputLanguage = "English";

const LANGUAGE_PROMPT_DIRECTIVES: Record<LlmOutputLanguage, string> = {
  English: "Write your entire response in English only.",
  Chinese: "Write your entire response in Chinese (简体中文) only.",
  Japanese: "Write your entire response in Japanese (日本語) only.",
  Korean: "Write your entire response in Korean (한국어) only.",
  Spanish: "Write your entire response in Spanish (español) only.",
  French: "Write your entire response in French (français) only.",
  German: "Write your entire response in German (Deutsch) only.",
  Portuguese: "Write your entire response in Portuguese (português) only.",
  Italian: "Write your entire response in Italian (italiano) only.",
  Russian: "Write your entire response in Russian (русский) only."
};

/** @deprecated Prefer resolveExtensionOutputLanguage for settings-backed values. */
export function normalizeOutputLanguage(value: string | undefined): LlmOutputLanguage {
  const trimmed = value?.trim();
  if (trimmed && (LLM_OUTPUT_LANGUAGES as readonly string[]).includes(trimmed)) {
    return trimmed as LlmOutputLanguage;
  }
  return DEFAULT_LLM_OUTPUT_LANGUAGE;
}

export function languagePromptDirective(language: LlmOutputLanguage): string {
  return LANGUAGE_PROMPT_DIRECTIVES[language];
}