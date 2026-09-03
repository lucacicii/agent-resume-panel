import React, { memo, useCallback, useMemo, useState } from "react";
import { Streamdown } from "streamdown";
import hljs from "highlight.js";
import { ThemeIcon } from "./ThemeIcon";
import { useI18n } from "../i18n";
import { sanitizeMarkdownProseTags } from "./Markdown";
import { ArtifactCard } from "./artifact/ArtifactCard";

export interface StreamdownRendererProps {
  content: string;
  isAnimating?: boolean;
  className?: string;
  onCitationClick?: (citationId: string) => void;
  onNoteClick?: (noteId: string) => void;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

interface StandardCodeBlockProps {
  language: string;
  code: string;
}

function useSafeI18n() {
  try {
    return useI18n();
  } catch {
    return { t: (key: string, ..._args: Array<string | number>) => key };
  }
}

const StandardCodeBlock = memo(function StandardCodeBlock({ language, code }: StandardCodeBlockProps) {
  const { t } = useSafeI18n();
  const [copied, setCopied] = useState(false);

  const lang = language.trim().toLowerCase();
  const resolvedLang = lang && hljs.getLanguage(lang) ? lang : "plaintext";

  const highlighted = useMemo(() => {
    if (resolvedLang === "plaintext") {
      return escapeHtml(code);
    }
    try {
      return hljs.highlight(code, { language: resolvedLang, ignoreIllegals: true }).value;
    } catch {
      return escapeHtml(code);
    }
  }, [code, resolvedLang]);

  const handleCopy = useCallback(async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(code);
      } else {
        const area = document.createElement("textarea");
        area.value = code;
        area.style.position = "fixed";
        area.style.opacity = "0";
        document.body.appendChild(area);
        area.select();
        document.execCommand("copy");
        area.remove();
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  }, [code]);

  return (
    <div className="code-block">
      <div className="code-block-head">
        {resolvedLang !== "plaintext" ? (
          <span className="code-block-lang">{resolvedLang}</span>
        ) : <span />}
        <button
          type="button"
          className="code-copy-btn"
          onClick={handleCopy}
          aria-label={t("desktop.common.copy", "Copy")}
        >
          <ThemeIcon name={copied ? "check" : "copy"} size={12} aria-hidden="true" />
          <span className="code-copy-label">
            {copied ? t("desktop.artifact.copied") : t("desktop.common.copy")}
          </span>
        </button>
      </div>
      <pre>
        <code
          className={`hljs language-${resolvedLang}`}
          dangerouslySetInnerHTML={{ __html: highlighted }}
        />
      </pre>
    </div>
  );
});

function preprocessLinks(markdown: string): string {
  // 1. Transform [N1], [S1], [D1] markers into markdown links: [N1](#citation-N1)
  let res = markdown.replace(/\[(N|S|D)(\d+)\](?!\()/g, "[$1$2](#citation-$1$2)");
  // 2. Transform noteId: <uuid> into noteId: [uuid](#note-uuid)
  res = res.replace(
    /(noteId[:：]\s*(?:`|<code>)?)([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})((?:`|<\/code>)?)/gi,
    "$1[$2](#note-$2)$3"
  );
  return res;
}

export const StreamdownRenderer = memo(function StreamdownRenderer({
  content,
  isAnimating = false,
  className = "markdown-body",
  onCitationClick,
  onNoteClick
}: StreamdownRendererProps) {
  // Pre-sanitize prose to protect generic types List<T>, <style>, <script> etc., and format links
  const sanitizedMarkdown = useMemo(() => {
    if (!content) return "";
    const linked = preprocessLinks(content);
    return sanitizeMarkdownProseTags(linked);
  }, [content]);

  const components = useMemo(() => {
    return {
      code({ inline, className: codeClassName, children, ...props }: any) {
        const codeString = String(children || "").replace(/\n$/, "");
        const match = /language-(\w+)/.exec(codeClassName || "");
        const lang = match ? match[1].toLowerCase() : "";

        // Inline code span
        if (inline || !match) {
          return (
            <code className={codeClassName} {...props}>
              {children}
            </code>
          );
        }

        // Intercept Artifact languages: html / svg / xml
        if (lang === "html" || lang === "svg" || (lang === "xml" && codeString.trim().startsWith("<svg"))) {
          return (
            <ArtifactCard
              language={lang}
              code={codeString}
              isStreaming={isAnimating}
            />
          );
        }

        // Standard code block
        return <StandardCodeBlock language={lang} code={codeString} />;
      },

      strong({ node, children, ...props }: any) {
        return <strong {...props}>{children}</strong>;
      },

      em({ node, children, ...props }: any) {
        return <em {...props}>{children}</em>;
      },

      del({ node, children, ...props }: any) {
        return <del {...props}>{children}</del>;
      },

      a({ node, href, children, ...props }: any) {
        // Citation link handling: e.g. #citation-N1
        if (href && href.startsWith("#citation-")) {
          const marker = href.replace("#citation-", "");
          return (
            <a
              href={href}
              className="agent-citation-link"
              data-agent-citation={marker}
              onClick={(e) => {
                e.preventDefault();
                onCitationClick?.(marker);
              }}
              {...props}
            >
              {children}
            </a>
          );
        }

        // Note link handling: e.g. #note-<uuid> or note:<uuid>
        if (href && (href.startsWith("#note-") || href.startsWith("note:"))) {
          const noteId = href.replace(/^#note-|^note:/, "");
          return (
            <a
              href={href}
              className="agent-citation-link im-note-link"
              data-note-id={noteId}
              onClick={(e) => {
                e.preventDefault();
                onNoteClick?.(noteId);
              }}
              {...props}
            >
              {children} ↗
            </a>
          );
        }

        return (
          <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
            {children}
          </a>
        );
      }
    };
  }, [isAnimating, onCitationClick, onNoteClick]);

  if (!sanitizedMarkdown) return null;

  return (
    <div className={className}>
      <Streamdown
        components={components}
        isAnimating={isAnimating}
      >
        {sanitizedMarkdown}
      </Streamdown>
    </div>
  );
});
