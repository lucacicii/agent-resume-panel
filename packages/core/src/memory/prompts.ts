export function buildDailySystemPrompt(outputLanguage: string): string {
  return [
    "You are a personal work-memory analyst for a software engineer who uses multiple AI coding agents.",
    "Given a list of agent sessions updated on a single calendar day, write a concise daily digest.",
    "Include: what was worked on, key decisions or outcomes, blockers/open questions, and suggested next steps.",
    "Group by project when helpful. Use bullet points. Do not invent work that is not implied by the inputs.",
    "Each session line includes a precomputed Summary when available. Ground the digest in those summaries; do not invent work not implied by them.",
    `Write the digest in language: ${outputLanguage}.`
  ].join(" ");
}

export function buildDailyUserPrompt(dateLabel: string, sessionLines: string[]): string {
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
  transcriptSnippet?: string;
  updatedAt: number;
}): string {
  const when = new Date(input.updatedAt).toISOString();
  const parts = [`[${input.provider}] ${input.title} @ ${input.projectPath} (${when})`];
  const summary = input.summary?.trim();
  if (summary) {
    parts.push(`   Summary: ${summary}`);
  }
  const snippet = input.transcriptSnippet?.trim();
  if (snippet) {
    parts.push(`   Transcript excerpt:\n${indentBlock(snippet, 3)}`);
  }
  return parts.join("\n");
}

function indentBlock(text: string, spaces: number): string {
  const pad = " ".repeat(spaces);
  return text
    .split("\n")
    .map((line) => `${pad}${line}`)
    .join("\n");
}

export function buildWeeklySystemPrompt(outputLanguage: string): string {
  return [
    "You are a personal work-memory analyst for a software engineer who uses multiple AI coding agents.",
    "Given daily digests and/or sessions from one calendar week, write a concise weekly review.",
    "Include: major themes, key decisions, cross-project links, unfinished work / debt, and suggested focus for next week.",
    "Cluster by theme or project. Use bullet points. Do not invent work not implied by the inputs.",
    `Write in language: ${outputLanguage}.`
  ].join(" ");
}

export function buildWeeklyUserPrompt(weekLabel: string, rangeHint: string, lines: string[]): string {
  if (!lines.length) {
    return `Week: ${weekLabel} (${rangeHint})\n\nNo daily digests or sessions in this week. Write a one-line note that there was no catalogued agent activity.`;
  }
  return [
    `Week: ${weekLabel}`,
    `Range: ${rangeHint}`,
    "",
    "Sources:",
    ...lines.map((line, i) => `--- Source ${i + 1} ---\n${line}`),
    "",
    "Write the weekly review now."
  ].join("\n");
}

export function buildMonthlySystemPrompt(outputLanguage: string): string {
  return [
    "You are a personal work-memory analyst for a software engineer who uses multiple AI coding agents.",
    "Given weekly/daily digests and/or sessions from one calendar month, write a concise monthly archive.",
    "Include: project stage shifts, recurring themes, important decisions, technical habits, and open threads for next month.",
    "Be selective; emphasize durable knowledge over day-to-day noise. Use bullet points. Do not invent facts.",
    `Write in language: ${outputLanguage}.`
  ].join(" ");
}

export function buildMonthlyUserPrompt(monthLabel: string, rangeHint: string, lines: string[]): string {
  if (!lines.length) {
    return `Month: ${monthLabel} (${rangeHint})\n\nNo digests or sessions in this month. Write a one-line note that there was no catalogued agent activity.`;
  }
  return [
    `Month: ${monthLabel}`,
    `Range: ${rangeHint}`,
    "",
    "Sources:",
    ...lines.map((line, i) => `--- Source ${i + 1} ---\n${line}`),
    "",
    "Write the monthly archive now."
  ].join("\n");
}
