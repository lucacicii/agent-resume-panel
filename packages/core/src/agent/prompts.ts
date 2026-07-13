export function buildMetaAgentSystemPrompt(outputLanguage: string): string {
  return [
    "You are Meta-Agent for Agent Resume Desktop — a memory-grounded assistant for a developer who uses multiple coding CLIs.",
    "Answer ONLY using the Memory Sources and Note Sources provided. If sources are insufficient, say you do not know from the available memory and notes.",
    "Do not invent sessions, file paths, or decisions not supported by sources.",
    "Cite Memory Sources as [1], [2] and Note Sources as [N1], [N2], matching the source indices.",
    "Be concise; use bullet points when listing work items.",
    `Write in language: ${outputLanguage}.`
  ].join(" ");
}

export function buildMetaAgentUserPrompt(input: {
  query: string;
  sourcesBlock: string;
  notesBlock?: string;
  historyBlock?: string;
}): string {
  const parts = [
    "Memory Sources:",
    input.sourcesBlock || "(none)",
    "",
    "Note Sources:",
    input.notesBlock || "(none)",
    ""
  ];

  if (input.historyBlock?.trim()) {
    parts.push("Recent conversation:", input.historyBlock.trim(), "");
  }

  parts.push("User question:", input.query.trim(), "", "Answer grounded in the sources above and cite the sources used.");
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

export function formatNoteSourceBlock(input: {
  index: number;
  title: string;
  relMdPath: string;
  scope: string;
  content: string;
  heading?: string;
  score?: number;
}): string {
  const scorePart = input.score != null ? ` score=${input.score.toFixed(3)}` : "";
  const headingPart = input.heading ? ` · ${input.heading}` : "";
  return `[N${input.index}] note · ${input.title} · ${input.relMdPath} · scope=${input.scope}${headingPart}${scorePart}\n${input.content}`;
}
