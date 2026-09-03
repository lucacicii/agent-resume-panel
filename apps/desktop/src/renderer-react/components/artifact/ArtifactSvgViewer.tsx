import React, { memo, useMemo, useState } from "react";
import DOMPurify from "dompurify";
import { ThemeIcon } from "../ThemeIcon";
import { useI18n } from "../../i18n";

export type SvgBackground = "checker" | "dark" | "light";

export interface ArtifactSvgViewerProps {
  code: string;
  minHeight?: number;
}

function useSafeI18n() {
  try {
    return useI18n();
  } catch {
    return { t: (key: string, ..._args: Array<string | number>) => key };
  }
}

export const ArtifactSvgViewer = memo(function ArtifactSvgViewer({
  code,
  minHeight = 260
}: ArtifactSvgViewerProps) {
  const { t } = useSafeI18n();
  const [bgMode, setBgMode] = useState<SvgBackground>("checker");

  const sanitizedSvg = useMemo(() => {
    let clean = code.trim();
    // Wrap if not enclosed in <svg>...</svg>
    if (!clean.toLowerCase().startsWith("<svg")) {
      const startIdx = clean.toLowerCase().indexOf("<svg");
      const endIdx = clean.toLowerCase().lastIndexOf("</svg>");
      if (startIdx !== -1 && endIdx !== -1) {
        clean = clean.slice(startIdx, endIdx + 6);
      }
    }

    return DOMPurify.sanitize(clean, {
      USE_PROFILES: { svg: true, svgFilters: true },
      ADD_ATTR: ["target"]
    });
  }, [code]);

  return (
    <div className="artifact-svg-viewer-container" style={{ minHeight }}>
      <div className="artifact-svg-bg-toolbar">
        <button
          type="button"
          className={`artifact-svg-bg-btn ${bgMode === "checker" ? "is-active" : ""}`}
          onClick={() => setBgMode("checker")}
          title={t("desktop.artifact.bgChecker")}
          aria-label={t("desktop.artifact.bgChecker")}
        >
          <span className="artifact-svg-swatch is-checker" />
        </button>
        <button
          type="button"
          className={`artifact-svg-bg-btn ${bgMode === "dark" ? "is-active" : ""}`}
          onClick={() => setBgMode("dark")}
          title={t("desktop.artifact.bgDark")}
          aria-label={t("desktop.artifact.bgDark")}
        >
          <span className="artifact-svg-swatch is-dark" />
        </button>
        <button
          type="button"
          className={`artifact-svg-bg-btn ${bgMode === "light" ? "is-active" : ""}`}
          onClick={() => setBgMode("light")}
          title={t("desktop.artifact.bgLight")}
          aria-label={t("desktop.artifact.bgLight")}
        >
          <span className="artifact-svg-swatch is-light" />
        </button>
      </div>

      <div
        className={`artifact-svg-canvas is-bg-${bgMode}`}
        dangerouslySetInnerHTML={{ __html: sanitizedSvg }}
      />
    </div>
  );
});
