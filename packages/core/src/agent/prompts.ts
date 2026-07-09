export function buildMetaAgentSystemPrompt(outputLanguage: string): string {
  return [
    "You are Meta-Agent for Agent Resume Desktop — a memory-grounded assistant for a developer who uses multiple coding CLIs.",
    "Answer ONLY using the Memory Sources provided. If sources are insufficient, say you do not know from memory and suggest generating daily/weekly digests.",
    "Do not invent sessions, file paths, or decisions not supported by sources.",
    "When you use a source, cite it with bracket numbers like [1] or [2] matching the source indices.",
    "Be concise; use bullet points when listing work items.",
    `Write in language: ${outputLanguage}.`
  ].join(" ");
}

export function buildMetaAgentUserPrompt(input: {
  query: string;
  sourcesBlock: string;
  historyBlock?: string;
}): string {
  const parts = [
    "Memory Sources:",
    input.sourcesBlock || "(none)",
    ""
  ];

  if (input.historyBlock?.trim()) {
    parts.push("Recent conversation:", input.historyBlock.trim(), "");
  }

  parts.push("User question:", input.query.trim(), "", "Answer grounded in the sources above.");
  return parts.join("\n");
}

export function formatSourceBlock(
  index: number,
  level: string,
  title: string,
  content: string,
  score?: number
): string {
  const scorePart = score != null ? ` score=${score.toFixed(3)}` : "";
  return `[${index}] ${level} · ${title}${scorePart}\n${content}`;
}
