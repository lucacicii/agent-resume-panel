

interface JsonlTranscriptRef {
  kind: "jsonl";
  paths: string[];
}

interface SqliteTranscriptRef {
  kind: "sqlite";
  dbPath: string;
  dialect: "opencode";
  sessionId: string;
}

interface AcpTranscriptRef {
  kind: "acp";
  threadPath: string;
  sessionsIndexPath: string;
}

interface UnavailableTranscriptRef {
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

