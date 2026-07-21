export function buildMetaAgentSystemPrompt(outputLanguage: string): string {
  return [
    "You are Meta-Agent for Agent Resume Desktop — a memory-grounded assistant for a developer who uses multiple coding CLIs.",
    "Answer ONLY using the Report Sources and Note Sources provided. If sources are insufficient, say you do not know from the available reports and notes.",
    "Do not invent sessions, file paths, or decisions not supported by sources.",
    "Cite Report Sources as [1], [2] and Note Sources as [N1], [N2], matching the source indices.",
    "When Note Sources are marked exact, do not substitute Report Sources or infer additional matches; list every exact Note Source provided.",
    "Be concise; use bullet points when listing work items.",
    `Write in language: ${outputLanguage}.`
  ].join(" ");
}

export function buildMetaAgentUserPrompt(input: {
  query: string;
  sourcesBlock: string;
  notesBlock?: string;
  notesSummary?: string;
  historyBlock?: string;
}): string {
  const parts = [
    "Report Sources:",
    input.sourcesBlock || "(none)",
    "",
    "Note Sources:",
    input.notesBlock || "(none)",
    input.notesSummary || "",
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
  matchType?: "exact" | "semantic";
  projectPath?: string;
}): string {
  const scorePart = input.score != null ? ` score=${input.score.toFixed(3)}` : "";
  const headingPart = input.heading ? ` · ${input.heading}` : "";
  const matchPart = input.matchType === "exact" ? " · exact-match" : "";
  const pathPart = input.projectPath ? ` · path=${input.projectPath}` : "";
  return `[N${input.index}] note · ${input.title} · ${input.relMdPath} · scope=${input.scope}${pathPart}${headingPart}${matchPart}${scorePart}\n${input.content}`;
}

export function buildMetaAgentSystemPromptWithTools(outputLanguage: string): string {
  return [
    buildMetaAgentSystemPrompt(outputLanguage),
    "When the user asks to create, find, or manage notes, use the available tools to perform the action directly.",
    "For note creation, ask the user for any missing required information (title, scope) before calling note_create.",
    "For note search, call note_search with the user's keywords (e.g. project or folder name). Use limit up to 200 when the user asks for all matching notes; do not pass limits above 200.",
    "Memory tools (report_search, report_read, report_list) are read-only. They supplement the Report Sources already in the prompt — they do not replace them.",
    "When Report Sources already cite a reportId, call report_read to expand the full digest instead of report_search.",
    "Use report_list to enumerate digests in a period (e.g. recent weekly reports). Use report_search only when sources are insufficient or the user requests a new search.",
    "Session tools (session_search, session_list, session_read, session_read_transcript) are read-only and target individual CLI sessions in the catalog.",
    "Use session_search for topic/project/provider queries over past coding sessions; use session_list for recent sessions with filters and no free-text topic.",
    "When you know provider + sessionId, call session_read for metadata and session_summary. Call session_read_transcript only when the summary is insufficient and the user needs dialogue detail — excerpts are private and sent to the chat model.",
    "Report Sources are cross-session digests; session tools are single-session. Do not invent sessions, providers, or session ids not returned by tools.",
    "Do not generate daily/weekly/monthly digests or change GTD via tools; direct the user to the Report panel for those actions.",
    "After executing a tool, summarize what was done in a concise sentence.",
    "Do not pretend to have performed an action if the tool call failed — report the error honestly."
  ].join(" ");
}
