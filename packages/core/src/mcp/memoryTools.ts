import { z } from "zod";
import { retrieveAgentContext, type RetrieveAgentContextResult } from "../agent/retrieve";

export interface MemoryToolContext {
  panelHome: string;
  catalogDb?: string;
  dbPath?: string;
}

export const MEMORY_RETRIEVE_DEFAULT_LIMIT = 6;
export const MEMORY_RETRIEVE_MAX_LIMIT = 20;

export const memoryRetrieveSchema = {
  query: z
    .string()
    .min(1)
    .describe(
      "Natural-language query to retrieve context across all local memory: memory digests (daily/weekly/monthly reports), project notes, and historical agent sessions with citation tags [D#], [N#], [S#]."
    ),
  projectPath: z
    .string()
    .optional()
    .describe("Optional working directory path to prioritize notes and sessions from a specific project."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(MEMORY_RETRIEVE_MAX_LIMIT)
    .optional()
    .describe(
      `Maximum number of results per category to retrieve. Defaults to ${MEMORY_RETRIEVE_DEFAULT_LIMIT}, capped at ${MEMORY_RETRIEVE_MAX_LIMIT}.`
    )
};

export async function handleMemoryRetrieve(
  ctx: MemoryToolContext,
  args: { query: string; projectPath?: string; limit?: number }
) {
  const result: RetrieveAgentContextResult = await retrieveAgentContext({
    query: args.query,
    panelHome: ctx.panelHome,
    projectPath: args.projectPath,
    limit: args.limit
  });

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            digests: result.digests.map((d, i) => ({
              citation: `[D${i + 1}]`,
              reportId: d.entry.id,
              level: d.entry.level,
              title: d.entry.title || d.entry.id,
              contentPreview: d.entry.content.slice(0, 1500),
              score: d.score
            })),
            notes: result.notes.map((n, i) => ({
              citation: `[N${i + 1}]`,
              noteId: n.noteId,
              title: n.title || n.relMdPath,
              relMdPath: n.relMdPath,
              scope: n.scope,
              heading: n.heading,
              snippet: n.content.slice(0, 1500),
              score: n.score
            })),
            sessions: result.sessions.map((s, i) => ({
              citation: `[S${i + 1}]`,
              provider: s.provider,
              sessionId: s.sessionId,
              title: s.title || s.sessionId,
              projectPath: s.projectPath,
              summary: s.summaryPreview,
              score: s.score
            })),
            citations: result.citations
          },
          null,
          2
        )
      }
    ]
  };
}
