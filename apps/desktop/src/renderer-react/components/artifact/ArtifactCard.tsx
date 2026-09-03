import React, { memo, useCallback, useMemo, useState } from "react";
import hljs from "highlight.js";
import { ThemeIcon } from "../ThemeIcon";
import { useI18n } from "../../i18n";
import { ArtifactHtmlSandbox } from "./ArtifactHtmlSandbox";
import { ArtifactSvgViewer } from "./ArtifactSvgViewer";

export interface ArtifactCardProps {
  language: string;
  code: string;
  title?: string;
  isStreaming?: boolean;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function useSafeI18n() {
  try {
    return useI18n();
  } catch {
    return { t: (key: string, ..._args: Array<string | number>) => key };
  }
}

export const ArtifactCard = memo(function ArtifactCard({
  language,
  code,
  title,
  isStreaming = false
}: ArtifactCardProps) {
  const { t } = useSafeI18n();
  const [activeTab, setActiveTab] = useState<"preview" | "code">("preview");
  const [reloadKey, setReloadKey] = useState(0);
  const [copied, setCopied] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const normalizedLang = useMemo(() => {
    const l = language.trim().toLowerCase();
    if (l === "svg" || l === "xml") return "svg";
    return "html";
  }, [language]);

  const displayTitle = useMemo(() => {
    if (title && title.trim()) return title.trim();
    if (normalizedLang === "svg") {
      return t("desktop.artifact.svgTitle");
    }
    return t("desktop.artifact.htmlTitle");
  }, [normalizedLang, title, t]);

  const highlightedCode = useMemo(() => {
    try {
      return hljs.highlight(code, {
        language: normalizedLang === "svg" ? "xml" : "html",
        ignoreIllegals: true
      }).value;
    } catch {
      return escapeHtml(code);
    }
  }, [code, normalizedLang]);

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

  const handleDownload = useCallback(() => {
    const ext = normalizedLang === "svg" ? ".svg" : ".html";
    const mime = normalizedLang === "svg" ? "image/svg+xml" : "text/html";
    const filename = (title ? title.trim().replace(/\s+/g, "-") : "artifact") + ext;

    const blob = new Blob([code], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, [code, normalizedLang, title]);

  const renderContent = (fullscreenMode = false) => {
    if (activeTab === "preview") {
      if (normalizedLang === "svg") {
        return <ArtifactSvgViewer code={code} minHeight={fullscreenMode ? 500 : 260} />;
      }
      return (
        <ArtifactHtmlSandbox
          code={code}
          reloadKey={reloadKey}
          isStreaming={isStreaming}
          minHeight={fullscreenMode ? 550 : 300}
        />
      );
    }

    return (
      <div className="artifact-code-view">
        <pre><code className={`hljs language-${normalizedLang}`} dangerouslySetInnerHTML={{ __html: highlightedCode }} /></pre>
      </div>
    );
  };

  return (
    <>
      <div className={`artifact-card ${isFullscreen ? "is-fullscreen-source" : ""}`}>
        <div className="artifact-card-header">
          <div className="artifact-card-badge-wrap">
            <span className={`artifact-lang-badge is-${normalizedLang}`}>
              {normalizedLang.toUpperCase()}
            </span>
            <span className="artifact-card-title" title={displayTitle}>
              {displayTitle}
            </span>
          </div>

          <div className="artifact-card-segmented-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "preview"}
              className={`artifact-tab-btn ${activeTab === "preview" ? "is-active" : ""}`}
              onClick={() => setActiveTab("preview")}
            >
              <ThemeIcon name="eye" size={13} aria-hidden="true" />
              <span>{t("desktop.artifact.preview")}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "code"}
              className={`artifact-tab-btn ${activeTab === "code" ? "is-active" : ""}`}
              onClick={() => setActiveTab("code")}
            >
              <ThemeIcon name="file-code" size={13} aria-hidden="true" />
              <span>{t("desktop.artifact.code")}</span>
            </button>
          </div>

          <div className="artifact-card-actions">
            {activeTab === "preview" && normalizedLang === "html" && (
              <button
                type="button"
                className="artifact-action-btn"
                onClick={() => setReloadKey((k) => k + 1)}
                title={t("desktop.artifact.reload")}
                aria-label={t("desktop.artifact.reload")}
              >
                <ThemeIcon name="refresh" size={13} aria-hidden="true" />
              </button>
            )}
            <button
              type="button"
              className="artifact-action-btn"
              onClick={handleCopy}
              title={copied ? t("desktop.artifact.copied") : t("desktop.artifact.copy")}
              aria-label={t("desktop.artifact.copy")}
            >
              <ThemeIcon name={copied ? "check" : "copy"} size={13} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="artifact-action-btn"
              onClick={handleDownload}
              title={t("desktop.artifact.save")}
              aria-label={t("desktop.artifact.save")}
            >
              <ThemeIcon name="download" size={13} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="artifact-action-btn"
              onClick={() => setIsFullscreen(true)}
              title={t("desktop.artifact.fullscreen")}
              aria-label={t("desktop.artifact.fullscreen")}
            >
              <ThemeIcon name="external-link" size={13} aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="artifact-card-body">
          {renderContent(false)}
        </div>
      </div>

      {isFullscreen && (
        <div
          className="artifact-modal-backdrop"
          role="dialog"
          aria-modal="true"
          onClick={() => setIsFullscreen(false)}
        >
          <div className="artifact-modal-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="artifact-card-header is-modal-header">
              <div className="artifact-card-badge-wrap">
                <span className={`artifact-lang-badge is-${normalizedLang}`}>
                  {normalizedLang.toUpperCase()}
                </span>
                <span className="artifact-card-title">{displayTitle}</span>
              </div>

              <div className="artifact-card-segmented-tabs" role="tablist">
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === "preview"}
                  className={`artifact-tab-btn ${activeTab === "preview" ? "is-active" : ""}`}
                  onClick={() => setActiveTab("preview")}
                >
                  <ThemeIcon name="eye" size={13} aria-hidden="true" />
                  <span>{t("desktop.artifact.preview")}</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === "code"}
                  className={`artifact-tab-btn ${activeTab === "code" ? "is-active" : ""}`}
                  onClick={() => setActiveTab("code")}
                >
                  <ThemeIcon name="file-code" size={13} aria-hidden="true" />
                  <span>{t("desktop.artifact.code")}</span>
                </button>
              </div>

              <div className="artifact-card-actions">
                {activeTab === "preview" && normalizedLang === "html" && (
                  <button
                    type="button"
                    className="artifact-action-btn"
                    onClick={() => setReloadKey((k) => k + 1)}
                    title={t("desktop.artifact.reload")}
                  >
                    <ThemeIcon name="refresh" size={14} aria-hidden="true" />
                  </button>
                )}
                <button
                  type="button"
                  className="artifact-action-btn"
                  onClick={handleCopy}
                  title={copied ? t("desktop.artifact.copied") : t("desktop.artifact.copy")}
                >
                  <ThemeIcon name={copied ? "check" : "copy"} size={14} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="artifact-action-btn"
                  onClick={handleDownload}
                  title={t("desktop.artifact.save")}
                >
                  <ThemeIcon name="download" size={14} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="artifact-action-btn is-close"
                  onClick={() => setIsFullscreen(false)}
                  title={t("desktop.artifact.exitFullscreen")}
                  aria-label={t("desktop.artifact.exitFullscreen")}
                >
                  <ThemeIcon name="close" size={14} aria-hidden="true" />
                </button>
              </div>
            </div>
            <div className="artifact-card-body is-modal-body">
              {renderContent(true)}
            </div>
          </div>
        </div>
      )}
    </>
  );
});
