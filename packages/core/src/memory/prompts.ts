export function buildDailySystemPrompt(outputLanguage: string): string {
  return [
    "You are a personal work-memory analyst for a software engineer who uses multiple AI coding agents.",
    "Given a list of agent sessions updated on a single calendar day, write a concise daily digest.",
    "Include: what was worked on, key decisions or outcomes, blockers/open questions, and suggested next steps.",
    "Group by project when helpful. Use bullet points. Do not invent work that is not implied by the inputs.",
    `Write the digest in language: ${outputLanguage}.`
  ].join(" ");
}

export function buildDailyUserPrompt(
  dateLabel: string,
  sessionLines: string[]
): string {
  if (!sessionLines.length) {
    return `Date: ${dateLabel}\n\nNo sessions were updated this day. Write a one-line note that the day had no catalogued agent activity.`;
  }

  return [
    `Date: ${dateLabel}`,
    "",
    "Sessions (most recent first):",
    ...sessionLines.map((line, i) => `${i + 1}. ${line}`),
    "",
    "Write the daily digest now."
  ].join("\n");
}

export function formatSessionForDigest(input: {
  provider: string;
  title: string;
  projectPath: string;
  summary?: string;
  updatedAt: number;
}): string {
  const when = new Date(input.updatedAt).toISOString();
  const summary = input.summary?.trim();
  if (summary) {
    return `[${input.provider}] ${input.title} @ ${input.projectPath} (${when})\n   Summary: ${summary}`;
  }
  return `[${input.provider}] ${input.title} @ ${input.projectPath} (${when})`;
}
