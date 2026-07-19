import DOMPurify from "dompurify";
import hljs from "highlight.js";
import { marked, type Tokens } from "marked";

function codeToken(token: Tokens.Code): string {
  const requested = token.lang?.trim().toLowerCase();
  const language = requested && hljs.getLanguage(requested) ? requested : "plaintext";
  const content = language === "plaintext"
    ? hljs.highlightAuto(token.text).value
    : hljs.highlight(token.text, { language, ignoreIllegals: true }).value;
  return `<pre><code class="hljs language-${language}">${content}</code></pre>`;
}

export function renderMarkdown(value: string): string {
  const renderer = new marked.Renderer();
  renderer.code = codeToken;
  return DOMPurify.sanitize(marked.parse(value, {
    gfm: true,
    breaks: true,
    renderer
  }) as string, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ["script", "style", "iframe", "object", "embed"],
    FORBID_ATTR: ["style"],
    ALLOW_UNKNOWN_PROTOCOLS: false
  });
}
