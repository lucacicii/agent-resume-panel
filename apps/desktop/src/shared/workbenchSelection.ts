/** Open Workbench session dots shared across the main window and floating notes. */

export const WORKBENCH_SESSION_DOT_STATUSES = [
  "awaiting_user",
  "running",
  "connecting",
  "error",
  "open"
] as const;

export type WorkbenchSessionDotStatus = (typeof WORKBENCH_SESSION_DOT_STATUSES)[number];

export const WORKBENCH_SESSION_AWAITING_CONFIDENCE = ["confirmed", "possible"] as const;
export type WorkbenchSessionAwaitingConfidence = (typeof WORKBENCH_SESSION_AWAITING_CONFIDENCE)[number];

export type WorkbenchActiveSessionDot = {
  paneKey: string;
  projectPath: string;
  title: string;
  sessionKey: string;
  status: WorkbenchSessionDotStatus;
  awaitingConfidence?: WorkbenchSessionAwaitingConfidence;
};

/** Same allowlist as Workbench "New session" picker (`cli:*` / `acp:*`). */
export const WORKBENCH_SEND_SELECTION_TARGETS = [
  "cli:codex",
  "cli:claude",
  "cli:grok",
  "cli:agy",
  "cli:opencode",
  "cli:pi",
  "cli:prime",
  "cli:cursor",
  "acp:claude",
  "acp:codex",
  "acp:grok",
  "acp:opencode",
  "acp:pi",
  "acp:prime"
] as const;

export type WorkbenchSendSelectionTarget = (typeof WORKBENCH_SEND_SELECTION_TARGETS)[number];

export type WorkbenchSendSelectionRequest =
  | {
      kind: "new-agent";
      text: string;
      target: WorkbenchSendSelectionTarget;
      projectPath?: string;
    }
  | {
      kind: "existing-session";
      text: string;
      paneKey: string;
      projectPath?: string;
    };

export type WorkbenchSendSelectionResult = { ok: true };

const SEND_SELECTION_TARGET_SET = new Set<string>(WORKBENCH_SEND_SELECTION_TARGETS);
const SESSION_DOT_STATUS_SET = new Set<string>(WORKBENCH_SESSION_DOT_STATUSES);
const AWAITING_CONFIDENCE_SET = new Set<string>(WORKBENCH_SESSION_AWAITING_CONFIDENCE);

const MAX_SELECTION_TEXT_CHARS = 200_000;
const MAX_ACTIVE_SESSIONS = 200;
const MAX_LABEL_CHARS = 2_000;

export function isWorkbenchSendSelectionTarget(value: unknown): value is WorkbenchSendSelectionTarget {
  return typeof value === "string" && SEND_SELECTION_TARGET_SET.has(value);
}

function asTrimmedString(value: unknown, max = MAX_LABEL_CHARS): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) return null;
  return trimmed;
}

function asOptionalPath(value: unknown): string | undefined {
  if (value == null || value === "") return undefined;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_LABEL_CHARS) return undefined;
  return trimmed;
}

export function parseWorkbenchActiveSessionDots(value: unknown): WorkbenchActiveSessionDot[] {
  if (!Array.isArray(value)) return [];
  const dots: WorkbenchActiveSessionDot[] = [];
  for (const item of value.slice(0, MAX_ACTIVE_SESSIONS)) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const paneKey = asTrimmedString(record.paneKey);
    const title = typeof record.title === "string" ? record.title.trim().slice(0, MAX_LABEL_CHARS) : "";
    const projectPath = typeof record.projectPath === "string" ? record.projectPath.trim().slice(0, MAX_LABEL_CHARS) : "";
    const sessionKey = typeof record.sessionKey === "string" ? record.sessionKey.trim().slice(0, MAX_LABEL_CHARS) : "";
    const status = typeof record.status === "string" && SESSION_DOT_STATUS_SET.has(record.status)
      ? record.status as WorkbenchSessionDotStatus
      : "open";
    if (!paneKey) continue;
    const dot: WorkbenchActiveSessionDot = {
      paneKey,
      projectPath,
      title,
      sessionKey,
      status
    };
    if (typeof record.awaitingConfidence === "string" && AWAITING_CONFIDENCE_SET.has(record.awaitingConfidence)) {
      dot.awaitingConfidence = record.awaitingConfidence as WorkbenchSessionAwaitingConfidence;
    }
    dots.push(dot);
  }
  return dots;
}

export function parseWorkbenchSendSelectionRequest(value: unknown): WorkbenchSendSelectionRequest {
  if (!value || typeof value !== "object") {
    throw new Error("Selection payload is required.");
  }
  const record = value as Record<string, unknown>;
  const text = typeof record.text === "string" ? record.text.trim() : "";
  if (!text) throw new Error("Selected text is required.");
  if (text.length > MAX_SELECTION_TEXT_CHARS) throw new Error("Selected text is too long.");
  const projectPath = asOptionalPath(record.projectPath);

  if (record.kind === "new-agent") {
    if (!isWorkbenchSendSelectionTarget(record.target)) {
      throw new Error("Unsupported agent target.");
    }
    return projectPath
      ? { kind: "new-agent", text, target: record.target, projectPath }
      : { kind: "new-agent", text, target: record.target };
  }

  if (record.kind === "existing-session") {
    const paneKey = asTrimmedString(record.paneKey);
    if (!paneKey) throw new Error("Session pane is required.");
    return projectPath
      ? { kind: "existing-session", text, paneKey, projectPath }
      : { kind: "existing-session", text, paneKey };
  }

  throw new Error("Unsupported selection action.");
}
