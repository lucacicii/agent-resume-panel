export function buildSummarizeSystemPrompt(outputLanguage: string): string {
  return [
    "You summarize coding agent chat sessions for a developer.",
    "Write a concise summary of what was accomplished, key decisions, and current state.",
    `Write the entire response in language: ${outputLanguage}.`,
    "Use short paragraphs or bullet points. Do not include markdown headings.",
    "Ignore the language used in the conversation transcript; always follow the required output language above."
  ].join(" ");
}

export function buildRenameSystemPrompt(outputLanguage: string): string {
  return [
    "You generate short session titles for coding agent conversations.",
    "Return only the title text: no quotes, no punctuation wrapper, max 80 characters.",
    `Write the title in language: ${outputLanguage}.`,
    "Ignore the language used in the conversation transcript; always follow the required output language above."
  ].join(" ");
}

export function buildSummarizeUserPrompt(transcript: string, outputLanguage: string): string {
  return `Summarize this session in ${outputLanguage}:\n\n${transcript}`;
}

export function buildRenameUserPrompt(
  transcript: string,
  currentTitle: string,
  outputLanguage: string
): string {
  return `Current title: ${currentTitle}\n\nGenerate a better short title in ${outputLanguage} for this session:\n\n${transcript}`;
}
