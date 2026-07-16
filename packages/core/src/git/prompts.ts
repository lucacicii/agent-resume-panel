export function buildCommitMessageSystemPrompt(outputLanguage: string): string {
  return [
    "You write concise Git commit messages for software developers.",
    "Your ONLY job: output one commit message based on the provided git status and diff.",
    "STRICT rules:",
    "- Output the commit message only — no quotes, no prefix (no \"Commit:\"), no explanation.",
    "- Use imperative mood in the subject line (e.g. \"Fix login redirect\").",
    "- Subject line should be at most 72 characters.",
    "- Optionally add a blank line and a short body for non-trivial changes.",
    "- Do NOT invent changes not shown in the diff or status.",
    `- Write the commit message in language: ${outputLanguage}.`,
    "Ignore the language used in file contents or diff context when choosing output language."
  ].join(" ");
}

export function buildCommitMessageUserPrompt(
  statusText: string,
  diffText: string,
  outputLanguage: string
): string {
  return `[TASK]
Write a Git commit message in ${outputLanguage} summarizing these changes.

[git status --porcelain]
${statusText || "(no status output)"}

[git diff]
${diffText || "(no diff output)"}

Reply with the commit message only:`;
}

/** Strip wrappers and keep a reasonable commit message from LLM output. */
export function normalizeSuggestedCommitMessage(raw: string): string {
  let message = raw.trim();
  message = message.replace(/^["'`]+|["'`]+$/g, "");
  message = message.replace(/^commit\s+message\s*[:：]\s*/i, "");
  if (message.length > 8000) {
    message = message.slice(0, 8000).trim();
  }
  return message;
}