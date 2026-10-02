/**
 * Prose-tag sanitizing for markdown rendering.
 *
 * Extracted from the retired `Markdown.ts` (marked-based renderer). The
 * StreamdownRenderer pipeline pre-processes every segment through
 * {@link sanitizeMarkdownProseTags} so generic-looking types (`List<T>`) and
 * raw HTML in prose are escaped instead of being parsed as markup, while
 * code fences and inline code spans pass through untouched.
 */

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
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
