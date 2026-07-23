import * as path from "node:path";
import { AgentSession, HistoryLoadOptions } from "../../history/types";
import { RenameHomes } from "../../history/rename";
import { acpTranscriptPaths, buildTranscriptIndexes, TranscriptIndexes } from "./indexes";
import { TranscriptRefs } from "./types";

export function homesFromLoadOptions(options: HistoryLoadOptions): RenameHomes {
  return {
    panelHome: options.panelHome,
    codexHome: options.codexHome,
    claudeHome: options.claudeHome,
    antigravityHome: options.antigravityHome,
    grokHome: options.grokHome,
    opencodeHome: options.opencodeHome,
    piHome: options.piHome,
    cursorHome: options.cursorHome,
    cursorIdeUserDataHome: options.cursorIdeUserDataHome
  };
}

export function resolveTranscriptRefs(
  session: AgentSession,
  homes: RenameHomes,
  indexes: TranscriptIndexes
): TranscriptRefs {
  switch (session.provider) {
    case "codex":
      return resolveCodex(session, indexes);
    case "claude":
      return resolveClaude(session, indexes);
    case "grok":
      return resolveGrok(session, indexes);
    case "pi":
      return resolvePi(session, indexes);
    case "agy":
      return resolveAgy(session, indexes);
    case "opencode":
      return resolveOpenCode(session, homes);
    case "cursor":
      return { kind: "unavailable", reason: "Cursor CLI transcript refs are synchronized by Core." };
    case "cursor-ide":
      return { kind: "unavailable", reason: "Cursor IDE composer headers do not expose conversation bodies." };
    case "chat":
      return resolveAcp(session, homes);
    default:
      return { kind: "unavailable", reason: `Unsupported provider: ${session.provider}` };
  }
}

function resolveCodex(session: AgentSession, indexes: TranscriptIndexes): TranscriptRefs {
  const paths = uniquePaths([
    ...(indexes.codex.get(session.id) ?? []),
    ...[...indexes.codex.entries()]
      .filter(([key]) => session.id.includes(key) || key.includes(session.id))
      .flatMap(([, files]) => files)
  ]);

  if (!paths.length) {
    return { kind: "unavailable", reason: "Codex rollout file not indexed" };
  }

  return { kind: "jsonl", paths };
}

function resolveClaude(session: AgentSession, indexes: TranscriptIndexes): TranscriptRefs {
  const paths = uniquePaths(indexes.claude.get(session.id) ?? []);
  if (!paths.length) {
    return { kind: "unavailable", reason: "Claude project jsonl not indexed" };
  }
  return { kind: "jsonl", paths };
}

function resolveGrok(session: AgentSession, indexes: TranscriptIndexes): TranscriptRefs {
  const paths = uniquePaths([
    ...(indexes.grok.get(session.id) ?? []),
    ...[...indexes.grok.values()].flat().filter((file) => file.includes(session.id))
  ]);
  if (!paths.length) {
    return { kind: "unavailable", reason: "Grok chat_history.jsonl not indexed" };
  }
  return { kind: "jsonl", paths };
}

function resolvePi(session: AgentSession, indexes: TranscriptIndexes): TranscriptRefs {
  const file = indexes.pi.get(session.id);
  if (!file) {
    return { kind: "unavailable", reason: "Pi session jsonl not indexed" };
  }
  return { kind: "jsonl", paths: [file] };
}

function resolveAgy(session: AgentSession, indexes: TranscriptIndexes): TranscriptRefs {
  const paths = uniquePaths(indexes.agy.get(session.id) ?? []);
  if (!paths.length) {
    return { kind: "unavailable", reason: "Antigravity history.jsonl only exposes limited metadata" };
  }
  return { kind: "jsonl", paths };
}

function resolveOpenCode(session: AgentSession, homes: RenameHomes): TranscriptRefs {
  return {
    kind: "sqlite",
    dbPath: path.join(homes.opencodeHome, "opencode.db"),
    dialect: "opencode",
    sessionId: session.id
  };
}

function resolveAcp(session: AgentSession, homes: RenameHomes): TranscriptRefs {
  const paths = acpTranscriptPaths(homes, session.id);
  return {
    kind: "acp",
    threadPath: paths.threadPath,
    sessionsIndexPath: paths.sessionsIndexPath
  };
}

function uniquePaths(paths: string[]): string[] {
  return [...new Set(paths)];
}

export async function resolveTranscriptRefsForSessions(
  sessions: AgentSession[],
  homes: RenameHomes
): Promise<Map<string, TranscriptRefs>> {
  const indexes = await buildTranscriptIndexes(homes);
  const output = new Map<string, TranscriptRefs>();
  for (const session of sessions) {
    output.set(catalogKey(session), resolveTranscriptRefs(session, homes, indexes));
  }
  return output;
}

export function catalogKey(session: Pick<AgentSession, "provider" | "id">): string {
  return `${session.provider}\u0000${session.id}`;
}
