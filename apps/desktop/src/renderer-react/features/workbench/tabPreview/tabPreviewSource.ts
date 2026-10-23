import { desktopApi } from "../../../bridge";
import type {
  TabPreviewContent,
  TabPreviewLine,
  TabPreviewMessage,
  TabPreviewTarget
} from "./types";

/** Live sources are cheap enough to reread after this; local ones never cache. */
const CACHE_TTL_MS = 2_000;
const SCREEN_LINES = 12;
const TEXT_LINES = 12;
const MESSAGES = 3;
const LINE_CHARS = 160;
const MESSAGE_CHARS = 400;
const DIFF_EXCERPT = 6;

/** Strips CSI/OSC escapes the headless mirror can leave in the screen text. */
const ANSI_PATTERN = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;

type CacheEntry = { at: number; content: TabPreviewContent | null };

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<TabPreviewContent | null>>();

/** Exported for tests: forget every cached live preview. */
export function clearTabPreviewCache(): void {
  cache.clear();
  inFlight.clear();
}

export function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, "");
}

function cleanLine(line: string): string {
  const trimmed = line.replace(/\s+$/, "");
  return trimmed.length > LINE_CHARS ? trimmed.slice(0, LINE_CHARS) : trimmed;
}

function splitLines(text: string): string[] {
  return text.replace(/\r\n?/g, "\n").split("\n");
}

/** The visible bottom of a terminal screen, without trailing blank rows. */
export function tailLines(text: string, max = SCREEN_LINES): string[] {
  const lines = splitLines(stripAnsi(text)).map(cleanLine);
  let end = lines.length;
  while (end > 0 && !lines[end - 1].trim()) end -= 1;
  return lines.slice(Math.max(0, end - max), end);
}

/** The head of a document, for editor and note content. */
export function firstLines(text: string, max = TEXT_LINES): string[] {
  const lines = splitLines(stripAnsi(text)).map(cleanLine);
  let end = lines.length;
  while (end > 0 && !lines[end - 1].trim()) end -= 1;
  return lines.slice(0, Math.min(end, max));
}

/** Note files open with a YAML block that says nothing about their content. */
export function stripFrontmatter(text: string): string {
  return text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
}

/**
 * Single-region line diff: common prefix and suffix are skipped, the middle
 * is counted and excerpted. Enough for a tab preview; the diff pane itself
 * shows the full, exact view.
 */
export function summarizeTextDiff(
  oldText: string,
  newText: string
): { added: number; removed: number; lines: TabPreviewLine[] } {
  const oldLines = splitLines(oldText);
  const newLines = splitLines(newText);
  let prefix = 0;
  while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < oldLines.length - prefix &&
    suffix < newLines.length - prefix &&
    oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  const removed = oldLines.slice(prefix, oldLines.length - suffix);
  const added = newLines.slice(prefix, newLines.length - suffix);
  const lines: TabPreviewLine[] = [
    ...removed.slice(0, DIFF_EXCERPT / 2).map((text) => ({ kind: "del" as const, text: cleanLine(text) })),
    ...added
      .slice(0, DIFF_EXCERPT - Math.min(removed.length, DIFF_EXCERPT / 2))
      .map((text) => ({ kind: "add" as const, text: cleanLine(text) }))
  ];
  return { added: added.length, removed: removed.length, lines };
}

function messageRole(role: string | undefined): TabPreviewMessage["role"] {
  return role === "user" ? "user" : role === "assistant" ? "assistant" : "other";
}

function toMessages(
  items: Array<{ role?: string; text?: string | null }>,
  limit = MESSAGES
): TabPreviewMessage[] {
  return items
    .filter((item) => (item.text ?? "").trim())
    .slice(-limit)
    .map((item) => ({
      role: messageRole(item.role),
      text: (item.text ?? "").trim().slice(0, MESSAGE_CHARS)
    }));
}

async function readScreen(target: Extract<TabPreviewTarget, { kind: "screen" }>): Promise<TabPreviewContent | null> {
  if (target.ptyId != null) {
    try {
      const dump = (await desktopApi().agentStatusScreen?.({ paneId: target.ptyId })) ?? null;
      const lines = dump?.screenText ? tailLines(dump.screenText) : [];
      if (lines.some((line) => line.trim())) return { kind: "screen", lines };
    } catch {
      // Fall through to the transcript.
    }
  }
  if (target.session) {
    try {
      const result = await desktopApi().previewSession({
        provider: target.session.provider,
        id: target.session.id
      });
      const messages = toMessages(result?.preview?.messages ?? []);
      if (messages.length) return { kind: "messages", messages };
    } catch {
      return null;
    }
  }
  return null;
}

async function readAcp(target: Extract<TabPreviewTarget, { kind: "acp" }>): Promise<TabPreviewContent | null> {
  const rows = await desktopApi().acpLoadMessages({ chatId: target.recordId });
  const messages = toMessages(rows ?? []);
  return messages.length ? { kind: "messages", messages } : null;
}

async function readThunder(
  target: Extract<TabPreviewTarget, { kind: "thunder" }>
): Promise<TabPreviewContent | null> {
  if (!target.sessionId) return null;
  const conversation = await desktopApi().thunderChatGetConversation({ sessionId: target.sessionId });
  if (!conversation) return null;
  const messages = toMessages(
    conversation.messages
      .filter((message) => message.role === "user" || message.role === "assistant")
      .map((message) => ({ role: message.role, text: message.content ?? "" }))
  );
  return messages.length ? { kind: "messages", messages } : null;
}

async function readNote(target: Extract<TabPreviewTarget, { kind: "note" }>): Promise<TabPreviewContent | null> {
  const result = await desktopApi().notesRead({ noteId: target.noteId });
  const lines = firstLines(stripFrontmatter(result?.content ?? ""));
  return lines.some((line) => line.trim()) ? { kind: "text", lines } : null;
}

function readText(target: Extract<TabPreviewTarget, { kind: "text" }>): TabPreviewContent | null {
  const lines = firstLines(target.text);
  return lines.some((line) => line.trim()) ? { kind: "text", lines } : null;
}

function readDiff(target: Extract<TabPreviewTarget, { kind: "diff" }>): TabPreviewContent | null {
  const summary = summarizeTextDiff(target.oldText, target.newText);
  if (!summary.added && !summary.removed) return null;
  return { kind: "diff", ...summary };
}

function readRemote(target: Exclude<TabPreviewTarget, { kind: "text" | "diff" }>) {
  switch (target.kind) {
    case "screen":
      return readScreen(target);
    case "acp":
      return readAcp(target);
    case "thunder":
      return readThunder(target);
    case "note":
      return readNote(target);
  }
}

/**
 * Load one tab's preview. Local panes answer synchronously; live panes reuse a
 * short-lived cache and dedupe concurrent reads, so sweeping the strip cannot
 * flood the IPC bridge. A `null` result means "nothing to show".
 */
export function loadTabPreview(target: TabPreviewTarget): Promise<TabPreviewContent | null> {
  if (target.kind === "text") return Promise.resolve(readText(target));
  if (target.kind === "diff") return Promise.resolve(readDiff(target));

  const now = Date.now();
  const cached = cache.get(target.key);
  if (cached && now - cached.at < CACHE_TTL_MS) return Promise.resolve(cached.content);

  const pending = inFlight.get(target.key);
  if (pending) return pending;

  const request = readRemote(target)
    .catch(() => null)
    .then((content) => {
      cache.delete(target.key);
      cache.set(target.key, { at: Date.now(), content });
      // Bounded: a long session should not accumulate one entry per closed tab.
      while (cache.size > 64) {
        const oldest = cache.keys().next().value;
        if (oldest === undefined) break;
        cache.delete(oldest);
      }
      return content;
    })
    .finally(() => {
      inFlight.delete(target.key);
    });

  inFlight.set(target.key, request);
  return request;
}
