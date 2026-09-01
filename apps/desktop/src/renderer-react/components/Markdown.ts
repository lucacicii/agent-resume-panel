import DOMPurify from "dompurify";
import hljs from "highlight.js";
import { marked, type Renderer, type Tokens } from "marked";

function codeToken(token: Tokens.Code): string {
  const requested = token.lang?.trim().toLowerCase();
  const language = requested && hljs.getLanguage(requested) ? requested : "plaintext";
  const content = language === "plaintext"
    ? hljs.highlightAuto(token.text).value
    : hljs.highlight(token.text, { language, ignoreIllegals: true }).value;
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

const MARKDOWN_CACHE_MAX = 500;
const markdownCache = new Map<string, string>();

const sharedRenderer = new marked.Renderer();
sharedRenderer.code = codeToken;

function parseMarkdown(value: string, renderer: Renderer): string {
  return marked.parse(value, {
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
