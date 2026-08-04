import DOMPurify from "dompurify";
import hljs from "highlight.js";
import { marked, type Renderer, type Tokens } from "marked";

const GTD_STATUSES = new Set(["inbox", "next", "waiting", "someday", "reference", "done"]);
const GTD_BLOCK = /^:::gtd\s+([a-z]+)\s*\n([\s\S]*?)\n:::\s*$/gm;
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

function renderGtdBlocks(value: string, renderer: Renderer): string {
  return value.replace(GTD_BLOCK, (source, rawStatus: string, rawText: string) => {
    if (!GTD_STATUSES.has(rawStatus) || !rawText.trim()) return source;
    const content = parseMarkdown(rawText.trim(), renderer);
    return "<article class=\"note-gtd-card\"><span class=\"gtd-status-tag is-" + rawStatus
      + "\">@GTD/" + rawStatus + "</span><div class=\"note-gtd-card-body\">" + content + "</div></article>";
  });
}

export function renderMarkdown(value: string): string {
  const renderer = new marked.Renderer();
  renderer.code = codeToken;
  const withGtd = renderGtdBlocks(value, renderer);
  return DOMPurify.sanitize(parseMarkdown(withGtd, renderer), {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ["script", "style", "iframe", "object", "embed"],
    FORBID_ATTR: ["style"],
    ALLOW_UNKNOWN_PROTOCOLS: false
  });
}
