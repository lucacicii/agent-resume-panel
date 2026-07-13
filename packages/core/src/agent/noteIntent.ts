import { chatCompletionDetailed } from "../llm/chat";
import { chatLlmConfigFromSettings } from "../llm/fromSettings";
import type { ChatMessage } from "../llm/types";
import {
  normalizeLlmNoteSearchPlan,
  NoteSearchPlan,
  planNoteSearchDeterministically,
  shouldAnalyzeNoteSearchWithLlm
} from "../notes/queryPlan";
import type { PanelSettings } from "../settings/types";
import { recordLlmUsage } from "../usage/store";

function parseJsonObject(content: string): unknown {
  const cleaned = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) {
    return undefined;
  }
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return undefined;
  }
}

export async function resolveNoteSearchPlan(options: {
  query: string;
  settings: PanelSettings;
  dbPath: string;
}): Promise<NoteSearchPlan> {
  const deterministic = planNoteSearchDeterministically(options.query);
  if (!shouldAnalyzeNoteSearchWithLlm(deterministic)) {
    return deterministic;
  }
  const llm = chatLlmConfigFromSettings(options.settings);
  if (!llm) {
    return deterministic;
  }

  const messages: ChatMessage[] = [
    {
      role: "system",
      content: [
        "Classify a note-search request as exact literal search or semantic search.",
        "Use exact only when the user asks for literal text, a marker, tag, filename, title, identifier, or explicit contains/matches semantics.",
        "Use semantic for about/related/similar/topic requests.",
        "For exact mode, split only the requested literal terms and choose operator all or any.",
        "Set fields to any of content, title, filename, path; tags are content.",
        "Return JSON only: {mode, terms, operator, fields, semanticQuery, notesOnly}."
      ].join(" ")
    },
    { role: "user", content: options.query.slice(0, 2000) }
  ];

  try {
    const result = await chatCompletionDetailed(llm, messages, 220);
    try {
      await recordLlmUsage(options.dbPath, {
        kind: "chat",
        source: "ask",
        jobKey: "notes:intent",
        model: result.model,
        usage: result.usage,
        durationMs: result.durationMs,
        ok: true
      });
    } catch {
      // non-fatal
    }
    return normalizeLlmNoteSearchPlan(parseJsonObject(result.content), deterministic) ?? deterministic;
  } catch {
    return deterministic;
  }
}
