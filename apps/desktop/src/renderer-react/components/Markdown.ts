import DOMPurify from "dompurify";
import hljs from "highlight.js";
import { marked, type Renderer, type Tokens } from "marked";

const GTD_STATUSES = new Set(["inbox", "next", "waiting", "someday", "reference", "done"]);
const GTD_BLOCK = /^:::gtd\s+([a-z]+)\s*\n([\s\S]*?)\n:::\s*$/gm;
// Use non-greedy body up to a line that is only `:::`. Allow empty body (`open\n:::`).
const NOTE_CHILD_BLOCK =
  /^:::note-child\s+([a-z_]+)(?:\s+note=([A-Za-z0-9._-]+))?(?:\s+status=([a-z_]+))?\s*\n([\s\S]*?)^:::\s*$/gm;
const SESSION_BLOCK =
  /^:::session\s+([A-Za-z0-9._-]+)\s+([a-z_]+)(?:\s+native=([A-Za-z0-9._/:|-]+))?\s*\n([\s\S]*?)^:::\s*$/gm;
const RUN_BLOCK = /^:::run\s+([a-z_]+)\s*\n([\s\S]*?)^:::\s*$/gm;
const RESULT_BLOCK = /^:::result\s+([a-z_]+)\s*\n([\s\S]*?)^:::\s*$/gm;

const NOTE_CHILD_STATUSES = new Set(["idle", "planned", "running", "done", "failed"]);
const SESSION_STATUSES = new Set(["idle", "planned", "running", "settled", "failed"]);
const RUN_STATUSES = new Set([
  "draft",
  "awaiting_approval",
  "executing",
  "completed",
  "partial",
  "failed"
]);
const RESULT_STATUSES = new Set(["completed", "failed", "partial", "blocked"]);

function codeToken(token: Tokens.Code): string {
  const requested = token.lang?.trim().toLowerCase();
  const language = requested && hljs.getLanguage(requested) ? requested : "plaintext";
  const content = language === "plaintext"
    ? hljs.highlightAuto(token.text).value
    : hljs.highlight(token.text, { language, ignoreIllegals: true }).value;
  return `<pre><code class="hljs language-${language}">${content}</code></pre>`;
}

function parseMarkdown(value: string, renderer: Renderer): string {
  return marked.parse(value, {
    gfm: true,
    breaks: true,
    renderer
  }) as string;
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function renderGtdBlocks(value: string, renderer: Renderer): string {
  return value.replace(GTD_BLOCK, (source, rawStatus: string, rawText: string) => {
    if (!GTD_STATUSES.has(rawStatus) || !rawText.trim()) return source;
    const content = parseMarkdown(rawText.trim(), renderer);
    return "<article class=\"note-gtd-card\"><span class=\"gtd-status-tag is-" + rawStatus
      + "\">@GTD/" + rawStatus + "</span><div class=\"note-gtd-card-body\">" + content + "</div></article>";
  });
}

function renderExecutableBlocks(value: string, renderer: Renderer): string {
  let next = value.replace(
    NOTE_CHILD_BLOCK,
    (source, statusToken: string, noteId: string | undefined, statusOverride: string | undefined, rawText: string) => {
      const status = NOTE_CHILD_STATUSES.has(statusOverride || "")
        ? statusOverride!
        : NOTE_CHILD_STATUSES.has(statusToken)
          ? statusToken
          : "idle";
      const body = rawText.trim()
        ? parseMarkdown(rawText.trim(), renderer)
        : "<p class=\"note-exec-empty\">(empty)</p>";
      const noteAttr = noteId ? ` data-note-id="${escapeAttr(noteId)}"` : "";
      const link = noteId
        ? `<span class="note-exec-meta">note=${escapeAttr(noteId)}</span>`
        : `<span class="note-exec-meta">unmaterialized</span>`;
      return (
        `<article class="note-exec-card note-child-card is-${escapeAttr(status)}"${noteAttr}>` +
        `<span class="note-exec-tag is-${escapeAttr(status)}">@child/${escapeAttr(status)}</span>` +
        link +
        `<div class="note-exec-body">${body}</div></article>`
      );
    }
  );

  next = next.replace(
    SESSION_BLOCK,
    (source, provider: string, status: string, native: string | undefined, rawText: string) => {
      if (!SESSION_STATUSES.has(status)) return source;
      const body = rawText.trim()
        ? parseMarkdown(rawText.trim(), renderer)
        : "<p class=\"note-exec-empty\">(empty session prompt)</p>";
      const nativeHtml = native
        ? `<span class="note-exec-meta">native=${escapeAttr(native)}</span>`
        : "";
      return (
        `<article class="note-exec-card note-session-card is-${escapeAttr(status)}" data-provider="${escapeAttr(provider)}">` +
        `<span class="note-exec-tag is-${escapeAttr(status)}">@session/${escapeAttr(provider)}/${escapeAttr(status)}</span>` +
        nativeHtml +
        `<div class="note-exec-body">${body}</div></article>`
      );
    }
  );

  next = next.replace(RUN_BLOCK, (source, status: string, rawText: string) => {
    if (!RUN_STATUSES.has(status)) return source;
    const body = rawText.trim()
      ? parseMarkdown(rawText.trim(), renderer)
      : "<p class=\"note-exec-empty\">Serial note-child run</p>";
    return (
      `<article class="note-exec-card note-run-card is-${escapeAttr(status)}">` +
      `<span class="note-exec-tag is-${escapeAttr(status)}">@run/${escapeAttr(status)}</span>` +
      `<div class="note-exec-body">${body}</div></article>`
    );
  });

  next = next.replace(RESULT_BLOCK, (source, status: string, rawText: string) => {
    if (!RESULT_STATUSES.has(status) || !rawText.trim()) return source;
    const body = parseMarkdown(rawText.trim(), renderer);
    return (
      `<article class="note-exec-card note-result-card is-${escapeAttr(status)}">` +
      `<span class="note-exec-tag is-${escapeAttr(status)}">@result/${escapeAttr(status)}</span>` +
      `<div class="note-exec-body">${body}</div></article>`
    );
  });

  return next;
}

export function renderMarkdown(value: string): string {
  const renderer = new marked.Renderer();
  renderer.code = codeToken;
  const withBlocks = renderExecutableBlocks(renderGtdBlocks(value, renderer), renderer);
  return DOMPurify.sanitize(parseMarkdown(withBlocks, renderer), {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ["script", "style", "iframe", "object", "embed"],
    FORBID_ATTR: ["style"],
    ALLOW_UNKNOWN_PROTOCOLS: false
  });
}
