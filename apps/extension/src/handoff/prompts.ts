import { languagePromptDirective, LlmOutputLanguage } from "../llm/languages";

export function buildHandoffSystemPrompt(language: LlmOutputLanguage): string {
  return `You write structured session handoff briefs for coding agents continuing another agent's work.
The reader is an autonomous coding agent that will pick up where the previous session left off.
${languagePromptDirective(language)}

Output plain text with these exact section headings (one per line, no markdown # prefix):
Goal:
Project:
Completed:
Key decisions:
Files touched:
Constraints:
Current blocker:
Next step:

Rules:
- Be specific: include file paths, function names, and concrete next actions where known.
- "Next step" must be a single clear instruction the new agent can execute immediately.
- "Files touched" lists paths only; one per line indented with "- " under the heading.
- If a section has no information, write "None" on the line after the heading.
- Do not invent work that is not supported by the transcript.
- Ignore the language used in the transcript; always follow the required output language above.`;
}

export function buildHandoffUserPrompt(transcript: string, language: LlmOutputLanguage): string {
  return `Write a handoff brief in ${language} for the next coding agent based on this session transcript:\n\n${transcript}`;
}