import { AgentSession, HistoryLoadOptions } from "../../history/types";
import { escapeSqlLiteral, runSqlite } from "../../history/sqlite";
import { catalogKey, homesFromLoadOptions, resolveTranscriptRefsForSessions } from "./resolve";
import { serializeTranscriptRefs } from "./types";

const REF_BATCH_SIZE = 100;

export async function syncTranscriptRefs(
  dbPath: string,
  sessions: AgentSession[],
  loadOptions: HistoryLoadOptions
): Promise<void> {
  if (!sessions.length) {
    return;
  }

  const homes = homesFromLoadOptions(loadOptions);
  const refsByKey = await resolveTranscriptRefsForSessions(sessions, homes);

  for (let index = 0; index < sessions.length; index += REF_BATCH_SIZE) {
    const batch = sessions.slice(index, index + REF_BATCH_SIZE);
    const statements = batch.map((session) => {
      const refs = refsByKey.get(catalogKey(session)) ?? { kind: "unavailable" as const };
      const serialized = serializeTranscriptRefs(refs);
      const provider = escapeSqlLiteral(session.provider);
      const id = escapeSqlLiteral(session.id);
      const kind = escapeSqlLiteral(serialized.kind);
      const json = escapeSqlLiteral(serialized.json);
      return `UPDATE sessions SET transcript_kind = '${kind}', transcript_refs = '${json}'
        WHERE provider = '${provider}' AND agent_session_id = '${id}';`;
    });
    await runSqlite(dbPath, `BEGIN;\n${statements.join("\n")}\nCOMMIT;`);
  }
}