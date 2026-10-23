import { createPortal } from "react-dom";
import { useLayoutEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { useI18n } from "../../../i18n";
import type { TabPreviewState } from "./useTabPreview";
import type { TabPreviewContent, TabPreviewTarget } from "./types";

type Props = {
  state: TabPreviewState;
  cardRef: RefObject<HTMLDivElement | null>;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
};

const VIEWPORT_MARGIN = 8;
const CARD_GAP = 6;
/** Fixed card width, so placement can happen before the content settles. */
const CARD_WIDTH = 340;

function accentClass(target: TabPreviewTarget): string {
  return `is-${target.accent}-group`;
}

/**
 * The delayed hover snapshot. Portaled to the body because both the tab strip
 * and the detail body clip their overflow; positioned against the tab's
 * viewport rect and flipped above when the strip sits near the bottom.
 */
export function TabPreviewCard({ state, cardRef, onPointerEnter, onPointerLeave }: Props) {
  const { t } = useI18n();
  const innerRef = useRef<HTMLDivElement | null>(null);
  const [placed, setPlaced] = useState<{ left: number; top: number; above: boolean } | null>(null);

  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    const height = card.offsetHeight;
    const width = card.offsetWidth || CARD_WIDTH;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const { anchor } = state;
    const centered = anchor.left + anchor.width / 2 - width / 2;
    const left = Math.min(
      Math.max(centered, VIEWPORT_MARGIN),
      Math.max(VIEWPORT_MARGIN, viewportWidth - width - VIEWPORT_MARGIN)
    );
    const below = anchor.bottom;
    const above = below + height > viewportHeight - VIEWPORT_MARGIN &&
      anchor.top - height >= VIEWPORT_MARGIN;
    const top = above
      ? anchor.top - height
      : Math.min(below, Math.max(VIEWPORT_MARGIN, viewportHeight - height - VIEWPORT_MARGIN));
    setPlaced({ left, top, above });
  }, [cardRef, state]);

  return createPortal(
    <div
      ref={cardRef}
      className={`wb-tab-preview ${accentClass(state.target)}${placed?.above ? " is-above" : ""}`}
      style={{ left: placed?.left ?? 0, top: placed?.top ?? 0, visibility: placed ? undefined : "hidden" }}
      aria-hidden="true"
      role="presentation"
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
    >
      <div ref={innerRef} className="wb-tab-preview-inner">
        <div className="wb-tab-preview-head">
          <span className="wb-tab-preview-dot" aria-hidden="true" />
          <span className="wb-tab-preview-title">{state.target.title}</span>
          {state.target.meta ? <span className="wb-tab-preview-meta">{state.target.meta}</span> : null}
        </div>
        <div className="wb-tab-preview-body">
          <CardBody state={state} t={t} />
        </div>
      </div>
    </div>,
    document.body
  );
}

function CardBody({ state, t }: { state: TabPreviewState; t: (key: string) => string }) {
  if (state.phase === "loading") {
    return <div className="wb-tab-preview-empty">{t("desktop.common.loadingPreview")}</div>;
  }
  if (state.phase === "error") {
    return <div className="wb-tab-preview-empty">{t("desktop.workbench.tabPreviewError")}</div>;
  }
  return <ReadyBody content={state.content} t={t} />;
}

function ReadyBody({ content, t }: { content: TabPreviewContent; t: (key: string) => string }) {
  if (content.kind === "screen" || content.kind === "text") {
    if (!content.lines.some((line) => line.trim())) {
      return <div className="wb-tab-preview-empty">{t("desktop.workbench.tabPreviewEmpty")}</div>;
    }
    return <pre className="wb-tab-preview-screen">{content.lines.join("\n")}</pre>;
  }
  if (content.kind === "messages") {
    if (!content.messages.length) {
      return <div className="wb-tab-preview-empty">{t("desktop.workbench.tabPreviewEmpty")}</div>;
    }
    return <>
      {content.messages.map((message, index) => (
        <div className="wb-tab-preview-msg" key={index}>
          <span className="wb-tab-preview-role">
            {message.role === "user"
              ? t("desktop.workbench.tabPreviewYou")
              : t("desktop.workbench.tabPreviewAssistant")}
          </span>
          <span className="wb-tab-preview-text">{message.text}</span>
        </div>
      ))}
    </>;
  }
  return <>
    <div className="wb-tab-preview-counts">
      <span className="is-add">+{content.added}</span>
      <span className="is-del">−{content.removed}</span>
    </div>
    <pre className="wb-tab-preview-screen">
      {content.lines.map((line) => `${line.kind === "add" ? "+" : line.kind === "del" ? "−" : " "}${line.text}`).join("\n")}
    </pre>
  </>;
}
