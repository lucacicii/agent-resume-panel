import { languagePromptDirective, LlmOutputLanguage } from "./languages";

export function buildSummarizeSystemPrompt(language: LlmOutputLanguage): string {
  return `You summarize coding agent chat sessions for a developer.
Write a concise summary of what was accomplished, key decisions, and current state.
${languagePromptDirective(language)}
Use short paragraphs or bullet points. Do not include markdown headings.
Ignore the language used in the conversation transcript; always follow the required output language above.`;
}

export function buildRenameSystemPrompt(language: LlmOutputLanguage): string {
  return `You generate short session titles for coding agent conversations.
Return only the title text: no quotes, no punctuation wrapper, max 80 characters.
${languagePromptDirective(language)}
Ignore the language used in the conversation transcript; always follow the required output language above.`;
}

export function buildSummarizeUserPrompt(transcript: string, language: LlmOutputLanguage): string {
  return `Summarize this session in ${language}:\n\n${transcript}`;
}

export function buildRenameUserPrompt(
  transcript: string,
  currentTitle: string,
  language: LlmOutputLanguage
): string {
  return `Current title: ${currentTitle}\n\nGenerate a better short title in ${language} for this session:\n\n${transcript}`;
}