import React, { useCallback, useEffect, useRef, useState } from "react";
import { ICON_SIZE, ThemeIcon } from "../../components/ThemeIcon";
import { ThinkingState } from "./ThinkingState";
import { ToolCallsState } from "./ToolCallsState";
import { useI18n } from "../../i18n";
import type { LiveSegment, LiveTurn } from "./useThunderChat";

/**
 * The run's finished turns as a stack of dots above the feed.
 *
 * The feed itself ever renders only the turn that is running, so the finished
 * ones live here: the dots overlap into a pile, and clicking one opens that
 * turn's thinking and tool calls in a drawer laid over the pane (absolute, so
 * the message flow does not reflow under it).
 *
 * The running turn gets no dot. It is on screen in the feed already, so a dot
 * for it would be a second, staler copy of the same thing; it stays reachable
 * from the drawer's arrows, which read the live segments as a magnifier.
 */
export function TurnDots({
  turns,
  openIndex,
  onOpen,
  onClose
}: {
  turns: readonly LiveTurn[];
  openIndex: number | null;
  onOpen: (index: number) => void;
  onClose: () => void;
  /** Unused today; kept out of the signature so callers cannot pass a stale one. */
}): React.JSX.Element | null {
  const { t } = useI18n();
  const trackRef = useRef<HTMLDivElement | null>(null);

  /** Finished turns, paired with their index in `turns` — the drawer is keyed by
   *  that index, so filtering must not renumber the dots. */
  const finished = turns
    .map((turn, index) => ({ turn, index }))
    .filter((entry) => entry.turn.status !== "running");

  // A long run walks off the end of the row; keep the newest dot in view.
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    track.scrollLeft = track.scrollWidth;
  }, [finished.length]);

  if (finished.length === 0) return null;

  return (
    <div className="tb-turn-dots" role="tablist" aria-label={t("desktop.chat.turns.label")}>
      <span className="tb-turn-dots-label">{t("desktop.chat.turns.label")}</span>
      <div className="tb-turn-dots-track" ref={trackRef}>
        {finished.map(({ turn, index }) => {
          const isOpen = openIndex === index;
          const title = describeTurn(turn, t);
          return (
            <button
              key={turn.turn}
              type="button"
              role="tab"
              aria-selected={isOpen}
              aria-label={title}
              title={title}
              className={`tb-turn-dot is-${turn.status}${isOpen ? " is-open" : ""}`}
              onClick={() => (isOpen ? onClose() : onOpen(index))}
            >
              <span className="tb-turn-dot-num">{turn.turn}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** The dot's tooltip / aria-label: what happened in this turn, and that it opens. */
function describeTurn(turn: LiveTurn, t: (key: string, ...args: Array<string | number>) => string): string {
  const parts = [t("desktop.chat.turns.turnN", turn.turn)];
  if (turn.toolCount > 0) parts.push(t("desktop.chat.turns.toolCount", turn.toolCount));
  if (turn.durationMs !== undefined) parts.push(`${(turn.durationMs / 1000).toFixed(1)}s`);
  // Only finished turns reach a dot, so a turn still running is either failed or done here.
  parts.push(
    turn.status === "error" ? t("desktop.chat.turns.statusError") : t("desktop.chat.turns.statusDone")
  );
  parts.push(t("desktop.chat.turns.openHint"));
  return parts.join(" · ");
}

/**
 * One turn's thinking and tool calls, in a drawer over the pane.
 *
 * `segments` is the caller's choice: the live array for the running turn (so it
 * keeps updating like a magnifier), the turn's own frozen copy once it is done.
 */
export function TurnDetailOverlay({
  turn,
  segments,
  isStreaming,
  index,
  total,
  onPrev,
  onNext,
  onClose
}: {
  turn: LiveTurn;
  segments: readonly LiveSegment[];
  isStreaming: boolean;
  index: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
}): React.JSX.Element {
  const { t } = useI18n();
  /**
   * The running turn has no duration until `turn_end`, so it is measured from
   * its own start. Ticking here (rather than taking a prop) keeps the drawer the
   * only component that re-renders on the seconds boundary.
   */
  const [runningMs, setRunningMs] = useState(0);
  useEffect(() => {
    if (turn.status !== "running") return;
    const tick = () => setRunningMs(Math.max(0, Date.now() - turn.startedAtMs));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [turn.status, turn.startedAtMs]);

  const onKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowLeft") onPrev();
      if (event.key === "ArrowRight") onNext();
    },
    [onClose, onNext, onPrev]
  );

  useEffect(() => {
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onKeyDown]);

  const shownMs = turn.durationMs ?? (turn.status === "running" ? runningMs : undefined);
  const lastIndex = segments.length - 1;

  return (
    <>
      <div className="tb-turn-overlay-mask" onClick={onClose} />
      <div className="tb-turn-overlay" role="dialog" aria-label={t("desktop.chat.turns.turnN", turn.turn)}>
        <header className="tb-turn-overlay-header">
          <span className="tb-turn-overlay-title">
            <ThemeIcon name="sparkles" size={ICON_SIZE.inline} />
            <span>{t("desktop.chat.turns.turnN", turn.turn)}</span>
            {turn.status === "running" ? (
              <span className="tb-turn-badge is-running">
                <span className="tb-turn-spinner" aria-hidden="true" />
                {t("desktop.chat.turns.statusRunning")}
              </span>
            ) : turn.status === "error" ? (
              <span className="tb-turn-badge is-error">{t("desktop.chat.turns.statusError")}</span>
            ) : (
              <span className="tb-turn-badge is-done">
                <ThemeIcon name="check" size={ICON_SIZE.inline} />
                {t("desktop.chat.turns.statusDone")}
              </span>
            )}
          </span>

          <span className="tb-turn-overlay-meta">
            {turn.toolCount > 0 && (
              <span className="tb-turn-meta-chip">
                <ThemeIcon name="terminal" size={ICON_SIZE.inline} />
                {turn.toolCount}
              </span>
            )}
            {shownMs !== undefined && (
              <span className="tb-turn-meta-chip">{(shownMs / 1000).toFixed(1)}s</span>
            )}
            {(turn.promptTokens !== undefined || turn.completionTokens !== undefined) && (
              <span className="tb-turn-meta-chip">
                {((turn.promptTokens ?? 0) + (turn.completionTokens ?? 0)).toLocaleString()} tok
              </span>
            )}
          </span>

          <span className="tb-turn-overlay-actions">
            <button
              type="button"
              className="tb-turn-nav"
              onClick={onPrev}
              disabled={index <= 0}
              title={t("desktop.chat.turns.prev")}
              aria-label={t("desktop.chat.turns.prev")}
            >
              <ThemeIcon name="chevron-left" size={ICON_SIZE.dense} />
            </button>
            <span className="tb-turn-nav-pos">
              {index + 1}/{total}
            </span>
            <button
              type="button"
              className="tb-turn-nav"
              onClick={onNext}
              disabled={index >= total - 1}
              title={t("desktop.chat.turns.next")}
              aria-label={t("desktop.chat.turns.next")}
            >
              <ThemeIcon name="chevron-right" size={ICON_SIZE.dense} />
            </button>
            <button
              type="button"
              className="tb-turn-nav"
              onClick={onClose}
              title={t("desktop.common.close")}
              aria-label={t("desktop.common.close")}
            >
              <ThemeIcon name="close" size={ICON_SIZE.dense} />
            </button>
          </span>
        </header>

        <div className="tb-turn-overlay-body">
          {segments.length === 0 ? (
            <div className="tb-turn-empty">{t("desktop.chat.turns.empty")}</div>
          ) : (
            segments.map((segment, segmentIndex) => {
              if (segment.kind === "reasoning") {
                return (
                  <ThinkingState
                    key={`turn_${turn.turn}_reasoning_${segmentIndex}`}
                    reasoning={segment.text}
                    isStreaming={isStreaming && segmentIndex === lastIndex}
                    defaultExpanded
                  />
                );
              }
              if (segment.kind === "tools") {
                return (
                  <ToolCallsState
                    key={`turn_${turn.turn}_tools_${segmentIndex}`}
                    tools={segment.tools}
                    isStreaming={isStreaming && segmentIndex === lastIndex}
                    defaultExpanded
                  />
                );
              }
              return (
                <div className="tb-turn-text" key={`turn_${turn.turn}_text_${segmentIndex}`}>
                  {segment.text}
                </div>
              );
            })
          )}
        </div>
      </div>
    </>
  );
}
