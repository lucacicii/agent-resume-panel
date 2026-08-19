export type TranscriptKind = "jsonl" | "sqlite" | "acp" | "unavailable";

export interface JsonlTranscriptRef {
  kind: "jsonl";
  paths: string[];
}

export interface SqliteTranscriptRef {
  kind: "sqlite";
  dbPath: string;
  dialect: "opencode";
  sessionId: string;
}

export interface AcpTranscriptRef {
  kind: "acp";
  threadPath: string;
  sessionsIndexPath: string;
}

export interface UnavailableTranscriptRef {
  kind: "unavailable";
  reason?: string;
}

export type TranscriptRefs = JsonlTranscriptRef | SqliteTranscriptRef | AcpTranscriptRef | UnavailableTranscriptRef;

export function parseTranscriptRefs(raw: string | null | undefined): TranscriptRefs | undefined {
  if (!raw?.trim()) {
    return undefined;
  }
  try {
    return JSON.parse(raw) as TranscriptRefs;
  } catch {
    return undefined;
  }
}

export function serializeTranscriptRefs(refs: TranscriptRefs): { kind: TranscriptKind; json: string } {
  return { kind: refs.kind, json: JSON.stringify(refs) };
}