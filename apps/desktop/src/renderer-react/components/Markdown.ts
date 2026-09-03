import DOMPurify from "dompurify";
import hljs from "highlight.js";
import { marked, type Renderer, type Tokens } from "marked";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function codeToken(token: Tokens.Code): string {
  const requested = token.lang?.trim().toLowerCase();
  const language = requested && hljs.getLanguage(requested) ? requested : "plaintext";
  let content = "";
  if (language === "plaintext") {
    content = escapeHtml(token.text);
  } else {
    try {
      content = hljs.highlight(token.text, { language, ignoreIllegals: true }).value;
    } catch {
      content = escapeHtml(token.text);
    }
  }
  const langLabel = language === "plaintext" ? "" : `<span class="code-block-lang">${language}</span>`;
  const copyButton = `<button type="button" class="code-copy-btn" aria-label="Copy code"><span class="code-copy-label">Copy</span></button>`;
  return `<div class="code-block"><div class="code-block-head">${langLabel}${copyButton}</div><pre><code class="hljs language-${language}">${content}</code></pre></div>`;
}

function copyPlainText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  return new Promise((resolve, reject) => {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    try {
      document.execCommand("copy")
        ? resolve()
        : reject(new Error("Copy failed"));
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
    } finally {
      area.remove();
    }
  });
}

// Delegated copy handler for code blocks rendered by renderMarkdown. Registered
// once at module load; works for any panel that renders markdown. Marking the
// button in the head keeps the copied text inside the sibling <code> element.
if (typeof document !== "undefined") {
  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest<HTMLButtonElement>(".code-copy-btn");
    if (!button) return;
    const block = button.closest<HTMLElement>(".code-block");
    const code = block?.querySelector("code");
    const text = code?.textContent ?? "";
    if (!text) return;
    void copyPlainText(text).then(() => {
      const label = button.querySelector<HTMLElement>(".code-copy-label");
      if (!label) return;
      const original = label.textContent || "";
      label.textContent = "Copied";
      window.setTimeout(() => { label.textContent = original; }, 1200);
    });
  });
}

const SAFE_HTML_TAGS = new Set([
  "a",
  "b",
  "blockquote",
  "br",
  "code",
  "del",
  "details",
  "em",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "i",
  "img",
  "ins",
  "kbd",
  "li",
  "mark",
  "ol",
  "p",
  "pre",
  "q",
  "rp",
  "rt",
  "ruby",
  "s",
  "samp",
  "small",
  "span",
  "strike",
  "strong",
  "sub",
  "summary",
  "sup",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "u",
  "ul"
]);

function escapeUnsafeTagsInProse(prose: string): string {
  return prose.replace(
    /<!--[\s\S]*?(?:-->|$)|<!DOCTYPE[^>]*>|<\/?[a-zA-Z][a-zA-Z0-9_:-]*(?:\s+[^>]*)?\/?>|<\/?>/gi,
    (match) => {
      const tagMatch = match.match(/^<\/?([a-zA-Z][a-zA-Z0-9_-]*)/);
      if (tagMatch) {
        const tagName = tagMatch[1].toLowerCase();
        if (SAFE_HTML_TAGS.has(tagName)) {
          return match;
        }
      }
      return escapeHtml(match);
    }
  );
}

export function sanitizeMarkdownProseTags(markdown: string): string {
  if (!markdown) return "";

  const segments: string[] = [];
  let index = 0;
  const len = markdown.length;

  while (index < len) {
    const isLineStart = index === 0 || markdown[index - 1] === "\n";
    if (isLineStart) {
      let spaceCount = 0;
      while (index + spaceCount < len && markdown[index + spaceCount] === " " && spaceCount < 4) {
        spaceCount++;
      }
      const fenceChar = markdown[index + spaceCount];
      if (fenceChar === "`" || fenceChar === "~") {
        let fenceLen = 0;
        while (index + spaceCount + fenceLen < len && markdown[index + spaceCount + fenceLen] === fenceChar) {
          fenceLen++;
        }
        if (fenceLen >= 3) {
          const fenceString = fenceChar.repeat(fenceLen);
          let endFenceIndex = -1;
          let searchPos = index + spaceCount + fenceLen;

          while (searchPos < len) {
            const nextNewline = markdown.indexOf("\n", searchPos);
            const lineStartPos = nextNewline === -1 ? len : nextNewline + 1;
            if (lineStartPos >= len) break;

            let lineSpace = 0;
            while (lineStartPos + lineSpace < len && markdown[lineStartPos + lineSpace] === " " && lineSpace < 4) {
              lineSpace++;
            }
            if (markdown.startsWith(fenceString, lineStartPos + lineSpace)) {
              let afterFence = lineStartPos + lineSpace + fenceLen;
              while (afterFence < len && markdown[afterFence] === fenceChar) {
                afterFence++;
              }
              while (afterFence < len && (markdown[afterFence] === " " || markdown[afterFence] === "\t")) {
                afterFence++;
              }
              if (afterFence >= len || markdown[afterFence] === "\n" || markdown[afterFence] === "\r") {
                const lineEnd = markdown.indexOf("\n", afterFence);
                endFenceIndex = lineEnd === -1 ? len : lineEnd + 1;
                break;
              }
            }
            searchPos = lineStartPos;
          }

          const blockEnd = endFenceIndex === -1 ? len : endFenceIndex;
          segments.push(markdown.slice(index, blockEnd));
          index = blockEnd;
          continue;
        }
      }
    }

    if (markdown[index] === "`") {
      let tickCount = 0;
      while (index + tickCount < len && markdown[index + tickCount] === "`") {
        tickCount++;
      }
      const ticks = "`".repeat(tickCount);
      const closeIndex = markdown.indexOf(ticks, index + tickCount);
      if (closeIndex !== -1) {
        const spanEnd = closeIndex + tickCount;
        segments.push(markdown.slice(index, spanEnd));
        index = spanEnd;
        continue;
      }
    }

    let nextIndex = index + 1;
    while (nextIndex < len) {
      if (markdown[nextIndex] === "`") break;
      if (markdown[nextIndex] === "~" && markdown[nextIndex - 1] === "\n") break;
      nextIndex++;
    }

    const prose = markdown.slice(index, nextIndex);
    segments.push(escapeUnsafeTagsInProse(prose));
    index = nextIndex;
  }

  return segments.join("");
}

const MARKDOWN_CACHE_MAX = 500;
const markdownCache = new Map<string, string>();

const sharedRenderer = new marked.Renderer();
sharedRenderer.code = codeToken;
sharedRenderer.html = (token) => {
  const raw = typeof token === "string" ? token : token.text;
  const tagMatch = raw.match(/^<\/?([a-zA-Z][a-zA-Z0-9_-]*)/);
  if (tagMatch && SAFE_HTML_TAGS.has(tagMatch[1].toLowerCase())) {
    return raw;
  }
  return escapeHtml(raw);
};

function parseMarkdown(value: string, renderer: Renderer): string {
  return marked.parse(sanitizeMarkdownProseTags(value), {
    gfm: true,
    breaks: true,
    renderer
  }) as string;
}

export function renderMarkdown(value: string): string {
  if (!value) return "";
  const cached = markdownCache.get(value);
  if (cached !== undefined) {
    markdownCache.delete(value);
    markdownCache.set(value, cached);
    return cached;
  }

  const parsed = DOMPurify.sanitize(parseMarkdown(value, sharedRenderer), {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ["script", "style", "iframe", "object", "embed"],
    FORBID_ATTR: ["style"],
    ALLOW_UNKNOWN_PROTOCOLS: false
  });

  if (markdownCache.size >= MARKDOWN_CACHE_MAX) {
    const oldestKey = markdownCache.keys().next().value;
    if (oldestKey !== undefined) {
      markdownCache.delete(oldestKey);
    }
  }
  markdownCache.set(value, parsed);

  return parsed;
}
