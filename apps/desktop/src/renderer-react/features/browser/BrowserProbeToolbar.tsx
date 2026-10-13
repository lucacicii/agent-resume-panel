import React from "react";
import { ICON_SIZE, ThemeIcon } from "../../components/ThemeIcon";
import { useI18n } from "../../i18n";

type BrowserProbeToolbarProps = {
  inspectMode: "inspect" | "markup" | "off";
  markupCount: number;
  errorCount: number;
  consoleCollapsed: boolean;
  viewportMode: string;
  zoom: string;
  cdpAttached: boolean;
  onToggleInspect: () => void;
  onToggleMarkup: () => void;
  onToggleDevTools: () => void;
  onToggleConsole: () => void;
  onViewportChange: (value: string) => void;
  onZoomChange: (value: string) => void;
};

const VIEWPORT_OPTIONS: Array<{ value: string; labelKey: string }> = [
  { value: "responsive", labelKey: "desktop.browser.probeViewportResponsive" },
  { value: "desktop-1080", labelKey: "desktop.browser.probeViewportDesktop1080" },
  { value: "desktop-900", labelKey: "desktop.browser.probeViewportDesktop900" },
  { value: "mobile-iphone", labelKey: "desktop.browser.probeViewportMobile" }
];

const ZOOM_OPTIONS = ["0.8", "1.0", "1.25"];

/** Probe controls that sit next to the browser's own navigation toolbar. */
export function BrowserProbeToolbar({
  inspectMode,
  markupCount,
  errorCount,
  consoleCollapsed,
  viewportMode,
  zoom,
  cdpAttached,
  onToggleInspect,
  onToggleMarkup,
  onToggleDevTools,
  onToggleConsole,
  onViewportChange,
  onZoomChange
}: BrowserProbeToolbarProps): React.JSX.Element {
  const { t } = useI18n();
  const inspecting = inspectMode === "inspect";
  const marking = inspectMode === "markup";

  return (
    <>
      <select
        className="browser-chrome-select"
        value={viewportMode}
        aria-label={t("desktop.browser.probeViewport")}
        title={t("desktop.browser.probeViewport")}
        onChange={(event) => onViewportChange(event.target.value)}
      >
        {VIEWPORT_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {t(option.labelKey)}
          </option>
        ))}
      </select>
      <select
        className="browser-chrome-select"
        value={zoom}
        aria-label={t("desktop.browser.probeZoom")}
        title={t("desktop.browser.probeZoom")}
        onChange={(event) => onZoomChange(event.target.value)}
      >
        {ZOOM_OPTIONS.map((option) => (
          <option key={option} value={option}>
            {`${Math.round(Number(option) * 100)}%`}
          </option>
        ))}
      </select>
      <button
        type="button"
        className={`browser-chrome-btn${inspecting ? " is-active" : ""}`}
        aria-pressed={inspecting}
        aria-label={inspecting ? t("desktop.browser.probeInspectActive") : t("desktop.browser.probeInspect")}
        title={t("desktop.browser.probeInspect")}
        onClick={onToggleInspect}
      >
        <ThemeIcon name="target" size={ICON_SIZE.dense} />
        <span className="browser-chrome-btn-label">
          {inspecting ? t("desktop.browser.probeInspectActive") : t("desktop.browser.probeInspect")}
        </span>
      </button>
      <button
        type="button"
        className={`browser-chrome-btn${marking ? " is-active" : ""}`}
        aria-pressed={marking}
        aria-label={t("desktop.browser.probeMarkup")}
        title={t("desktop.browser.probeMarkup")}
        onClick={onToggleMarkup}
      >
        <ThemeIcon name="pencil" size={ICON_SIZE.dense} />
        <span className="browser-chrome-btn-label">
          {marking ? t("desktop.browser.probeMarkupActive", markupCount) : t("desktop.browser.probeMarkup")}
        </span>
      </button>
      <button
        type="button"
        className="browser-chrome-btn"
        aria-label={t("desktop.browser.probeDevtools")}
        title={t("desktop.browser.probeDevtools")}
        onClick={onToggleDevTools}
      >
        <ThemeIcon name="wrench" size={ICON_SIZE.dense} />
      </button>
      <button
        type="button"
        className={`browser-chrome-btn${errorCount > 0 && consoleCollapsed ? " is-alert" : ""}${cdpAttached ? "" : " is-muted"}`}
        aria-label={t("desktop.browser.probeConsole")}
        title={t("desktop.browser.probeConsole")}
        onClick={onToggleConsole}
      >
        <ThemeIcon name="terminal" size={ICON_SIZE.dense} />
        <span className="browser-chrome-btn-label">{t("desktop.browser.probeConsole")}</span>
        {errorCount > 0 ? <span className="browser-chrome-btn-count">{`(${errorCount})`}</span> : null}
      </button>
    </>
  );
}
