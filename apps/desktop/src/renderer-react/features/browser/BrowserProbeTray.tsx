import React from "react";
import type { BrowserProbeMarkup, BrowserProbeTarget } from "../../../shared/browserTypes";
import { ICON_SIZE, ThemeIcon } from "../../components/ThemeIcon";
import { useI18n } from "../../i18n";
import { buildInspectPrompt, buildMarkupPrompt } from "./probePrompt";

type BrowserProbeTrayProps = {
  target: BrowserProbeTarget | null;
  markups: BrowserProbeMarkup[];
  onClearTarget: () => void;
  onRemoveMarkup: (id: string) => void;
  onClearMarkups: () => void;
  onOpenSource: (path: string, line?: number) => void;
  onSendToSession: (text: string) => void;
};

/** Picks and annotations waiting to be handed to the session. Nothing to show, nothing rendered. */
export function BrowserProbeTray({
  target,
  markups,
  onClearTarget,
  onRemoveMarkup,
  onClearMarkups,
  onOpenSource,
  onSendToSession
}: BrowserProbeTrayProps): React.JSX.Element | null {
  const { t } = useI18n();
  if (!target && markups.length === 0) return null;

  const sourceLabel = target
    ? `${target.sourceLocated === false ? "~" : ""}${target.sourceFile}${target.sourceLine ? `:${target.sourceLine}` : ""}`
    : "";

  return (
    <div className="browser-probe-tray">
      {target ? (
        <div className="browser-probe-card">
          <div className="browser-probe-head">
            <span className="browser-probe-title">
              {t("desktop.browser.probeTargetInspect", target.componentName || target.tagName)}
            </span>
            <button
              type="button"
              className="browser-chrome-btn"
              aria-label={t("desktop.common.close")}
              title={t("desktop.common.close")}
              onClick={onClearTarget}
            >
              <ThemeIcon name="close" size={ICON_SIZE.inline} />
            </button>
          </div>
          <code className="browser-probe-detail">{target.selector}</code>
          {sourceLabel ? <code className="browser-probe-detail">{sourceLabel}</code> : null}
          <div className="browser-probe-actions">
            <button
              type="button"
              className="browser-chrome-btn"
              disabled={!target.sourceFile}
              onClick={() => onOpenSource(target.sourceFile ?? "", target.sourceLine)}
            >
              {t("desktop.browser.probeOpenSource")}
            </button>
            <button
              type="button"
              className="browser-chrome-btn"
              onClick={() => void navigator.clipboard?.writeText(buildInspectPrompt(t, target)).catch(() => undefined)}
            >
              {t("desktop.common.copy")}
            </button>
            <button
              type="button"
              className="browser-chrome-btn is-primary"
              onClick={() => {
                onSendToSession(buildInspectPrompt(t, target));
                onClearTarget();
              }}
            >
              {t("desktop.browser.probeSendToSession")}
            </button>
          </div>
        </div>
      ) : null}

      {markups.length > 0 ? (
        <div className="browser-probe-card">
          <div className="browser-probe-head">
            <span className="browser-probe-title">
              {t("desktop.browser.probeTargetMarkup", markups.length)}
            </span>
            <button type="button" className="browser-chrome-btn" onClick={onClearMarkups}>
              {t("desktop.browser.probeClearMarkups")}
            </button>
            <button
              type="button"
              className="browser-chrome-btn is-primary"
              onClick={() => {
                onSendToSession(buildMarkupPrompt(t, markups));
                onClearMarkups();
              }}
            >
              {t("desktop.browser.probeSendToSession")}
            </button>
          </div>
          {markups.map((markup, index) => (
            <div className="browser-probe-markup-row" key={markup.id}>
              <span className="browser-probe-note">{`#${index + 1} ${markup.note}`}</span>
              {markup.target ? (
                <span className="browser-probe-markup-target">{`<${markup.target.componentName || markup.target.tagName}>`}</span>
              ) : null}
              <button
                type="button"
                className="browser-chrome-btn"
                aria-label={t("desktop.common.close")}
                title={t("desktop.common.close")}
                onClick={() => onRemoveMarkup(markup.id)}
              >
                <ThemeIcon name="close" size={ICON_SIZE.inline} />
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
