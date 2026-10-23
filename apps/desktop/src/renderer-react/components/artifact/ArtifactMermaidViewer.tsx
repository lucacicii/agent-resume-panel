import { memo, useEffect, useMemo, useRef, useState } from "react";
import DOMPurify from "dompurify";
import mermaid from "mermaid";
import { useI18n } from "../../i18n";

interface ArtifactMermaidViewerProps {
  code: string;
  minHeight?: number;
}

type RenderState =
  | { kind: "rendering" }
  | { kind: "ready"; svg: string }
  | { kind: "error"; message: string };

let diagramSequence = 0;

function useSafeI18n() {
  try {
    return useI18n();
  } catch {
    return { t: (key: string, ..._args: Array<string | number>) => key };
  }
}

/**
 * Renders one ` ```mermaid ` fence.
 *
 * Mermaid bakes its palette into the SVG it emits, so the appearance is read
 * before the render and a theme change re-renders rather than restyles.
 *
 * `parse` runs before `render` on purpose: a diagram the model got wrong is a
 * common case, and it must fall back to the fence's own source instead of
 * leaving mermaid's error graphic in the transcript.
 */
export const ArtifactMermaidViewer = memo(function ArtifactMermaidViewer({
  code,
  minHeight = 260
}: ArtifactMermaidViewerProps) {
  const { t } = useSafeI18n();
  const [state, setState] = useState<RenderState>({ kind: "rendering" });
  const [theme, setTheme] = useState<"dark" | "default">(() =>
    document.documentElement.dataset.theme === "dark" ? "dark" : "default"
  );
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Same three signals the diff view follows: the settings broadcast, the OS
  // preference, and the root attribute the app writes.
  useEffect(() => {
    const applyTheme = () =>
      setTheme(document.documentElement.dataset.theme === "dark" ? "dark" : "default");
    applyTheme();
    window.addEventListener("agent-resume:appearance-change", applyTheme);
    const media = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: dark)") : null;
    media?.addEventListener("change", applyTheme);
    const observer = new MutationObserver(applyTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => {
      window.removeEventListener("agent-resume:appearance-change", applyTheme);
      media?.removeEventListener("change", applyTheme);
      observer.disconnect();
    };
  }, []);

  // Deferred while the fence is off-screen: a long transcript can hold many
  // diagrams, and each one costs a full layout pass inside mermaid.
  const [visible, setVisible] = useState(() => typeof IntersectionObserver !== "function");
  useEffect(() => {
    if (visible || typeof IntersectionObserver !== "function") return;
    const node = containerRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px" }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    diagramSequence += 1;
    const id = `mermaid-${diagramSequence}`;
    setState({ kind: "rendering" });

    void (async () => {
      try {
        mermaid.initialize({
          startOnLoad: false,
          theme,
          securityLevel: "strict",
          fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
          suppressErrorRendering: true,
          // Mermaid's default labels are `foreignObject` HTML, which the SVG
          // sanitizer profile strips — the diagram would draw as empty boxes.
          // Native `<text>` survives, and it is also what a transcript wants: a
          // diagram that scales like an image rather than embedded HTML.
          // Top-level in mermaid 12; `flowchart.htmlLabels` is ignored.
          htmlLabels: false
        });
        await mermaid.parse(code);
        const { svg } = await mermaid.render(id, code);
        if (cancelled) return;
        setState({ kind: "ready", svg });
      } catch (error) {
        if (cancelled) return;
        // Mermaid leaves the element it rendered into behind on failure.
        document.getElementById(`d${id}`)?.remove();
        setState({
          kind: "error",
          message: error instanceof Error ? error.message : String(error)
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [code, theme, visible]);

  const sanitizedSvg = useMemo(
    () => (state.kind === "ready" ? DOMPurify.sanitize(state.svg, { USE_PROFILES: { svg: true, svgFilters: true } }) : ""),
    [state]
  );

  return (
    <div className="artifact-mermaid-viewer-container" style={{ minHeight }} ref={containerRef}>
      {state.kind === "rendering" && (
        <div className="artifact-mermaid-placeholder">{t("desktop.artifact.diagramRendering")}</div>
      )}
      {state.kind === "error" && (
        <div className="artifact-mermaid-error">
          <span className="artifact-mermaid-error-label">{t("desktop.artifact.diagramInvalid")}</span>
          <pre>{code}</pre>
          <span className="artifact-mermaid-error-detail">{state.message}</span>
        </div>
      )}
      {state.kind === "ready" && (
        <div
          className="artifact-mermaid-canvas"
          // Mermaid emits an SVG document; `DOMPurify` above is what makes this safe.
          dangerouslySetInnerHTML={{ __html: sanitizedSvg }}
        />
      )}
    </div>
  );
});
