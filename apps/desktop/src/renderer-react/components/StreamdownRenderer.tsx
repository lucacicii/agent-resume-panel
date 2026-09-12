import React, { memo, useCallback, useMemo, useRef, useState } from "react";
import { Streamdown, type Components, type UrlTransform } from "streamdown";
import hljs from "highlight.js";
import { ThemeIcon } from "./ThemeIcon";
import { useI18n } from "../i18n";
import { ArtifactCard } from "./artifact/ArtifactCard";
import { buildMarkdownSegments, type MarkdownSegmentState } from "./markdownSegments";
import {
  fromStreamdownSafeSrc,
  resolveMarkdownImageSrc,
  type MarkdownImageLabels,
  type MarkdownImageOptions
} from "./markdownImage";

export interface StreamdownRendererProps {
  content: string;
  isAnimating?: boolean;
  className?: string;
  onCitationClick?: (citationId: string) => void;
  onNoteClick?: (noteId: string) => void;
  onImageClick?: (url: string) => void;
  imageOptions?: MarkdownImageOptions;
  imageLabels?: Partial<MarkdownImageLabels>;
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

const FALLBACK_I18N = { t: (key: string, ..._args: Array<string | number>) => key };

function useSafeI18n() {
  try {
    return useI18n();
  } catch {
    // Stable fallback: an unstable `t` would invalidate memoized markdown on
    // every render and re-parse content that did not change.
    return FALLBACK_I18N;
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

/**
 * Renders one markdown segment. Segments keep their identity while the document
 * only grows, so a growing neighbour does not re-parse unchanged markdown.
 */
const MarkdownSegmentView = memo(function MarkdownSegmentView({
  content,
  components,
  translations,
  urlTransform
}: {
  content: string;
  components: Components;
  translations: React.ComponentProps<typeof Streamdown>["translations"];
  urlTransform: UrlTransform;
}): React.JSX.Element {
  return (
    <Streamdown
      components={components}
      isAnimating={false}
      animated={false}
      translations={translations}
      urlTransform={urlTransform}
    >
      {content}
    </Streamdown>
  );
});

export const StreamdownRenderer = memo(function StreamdownRenderer({
  content,
  className = "markdown-body",
  onCitationClick,
  onNoteClick,
  onImageClick,
  imageOptions,
  imageLabels
}: StreamdownRendererProps) {
  const { t } = useSafeI18n();

  // Pre-sanitize prose to protect generic types List<T>, <style>, <script> etc.,
  // and format links. Appends reuse the segments that already closed.
  const streamStateRef = useRef<MarkdownSegmentState | null>(null);
  const segments = useMemo(() => {
    const next = buildMarkdownSegments(
      streamStateRef.current,
      content,
      imageOptions
    );
    streamStateRef.current = next;
    return next.segments;
  }, [content, imageOptions]);

  const translations = useMemo(() => ({
    copyTable: t("desktop.artifact.copy", "Copy"),
    copyTableAsMarkdown: "Markdown",
    copyTableAsCsv: "CSV",
    copyTableAsTsv: "TSV",
    downloadTable: t("desktop.artifact.save", "Save"),
    downloadTableAsCsv: "CSV",
    downloadTableAsMarkdown: "Markdown",
    viewFullscreen: t("desktop.artifact.fullscreen", "Fullscreen"),
    exitFullscreen: t("desktop.artifact.exitFullscreen", "Exit Fullscreen"),
    tableFormatCsv: "CSV",
    tableFormatMarkdown: "Markdown",
    tableFormatTsv: "TSV"
  }), [t]);

  const components = useMemo<Components>(() => ({
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
              isStreaming={false}
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
      },

      img({ src, alt, ...props }: any) {
        const rawSrc = typeof src === "string" ? src : "";
        const resolved = fromStreamdownSafeSrc(rawSrc) || resolveMarkdownImageSrc(rawSrc, imageOptions);
        if (resolved.kind === "local" || resolved.kind === "data") {
          return (
            <img
              {...props}
              src={resolved.url}
              alt={alt || ""}
              className="md-preview-img"
              loading="lazy"
              onClick={() => onImageClick?.(resolved.url)}
            />
          );
        }
        if (resolved.kind === "remote") {
          return (
            <span className="md-image-remote">
              <span className="md-image-remote-label">
                {imageLabels?.remoteImage || t("desktop.markdown.remoteImage", "Remote image")} · {resolved.host}
              </span>
              <a href={resolved.href} target="_blank" rel="noopener noreferrer">
                {imageLabels?.openInBrowser || t("desktop.markdown.openInBrowser", "Open in browser")}
              </a>
            </span>
          );
        }
        return (
          <span className="md-image-missing">
            {alt || imageLabels?.unavailable || t("desktop.markdown.imageUnavailable", "Image unavailable")}
          </span>
        );
      }
  }), [imageLabels, imageOptions, onCitationClick, onImageClick, onNoteClick, t]);

  const handlePreviewClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (!(event.target instanceof HTMLImageElement)) return;
    const src = event.target.getAttribute("src") || event.target.src || "";
    if (src) onImageClick?.(src);
  }, [onImageClick]);

  const urlTransform = useCallback((url: string) => url, []);

  if (!segments.some((segment) => segment.prepared.length > 0)) return null;

  return (
    <div
      className={className}
      onClick={handlePreviewClick}
    >
      {segments.map((segment, index) => (
        <MarkdownSegmentView
          key={index}
          content={segment.prepared}
          components={components}
          translations={translations}
          urlTransform={urlTransform}
        />
      ))}
    </div>
  );
});
