import { useState, type CSSProperties, type JSX } from "react";
import { ThemeIcon } from "../../components/ThemeIcon";
import type { TimelineNode } from "./timelineModel";

interface ImTimelineProps {
  nodes: TimelineNode[];
  activeMessageId?: string;
  onJump: (messageId: string) => void;
  onJumpTop: () => void;
  onJumpBottom: () => void;
  t: (key: string, ...args: Array<string | number>) => string;
}

export function ImTimeline({
  nodes,
  activeMessageId,
  onJump,
  onJumpTop,
  onJumpBottom,
  t
}: ImTimelineProps): JSX.Element | null {
  const [hoveredNode, setHoveredNode] = useState<TimelineNode | null>(null);
  const [hoverTop, setHoverTop] = useState<number>(0);

  if (nodes.length < 3) return null;

  return (
    <aside className="im-timeline" aria-label={t("desktop.im.timeline")} onMouseLeave={() => setHoveredNode(null)}>
      <button
        type="button"
        className="im-timeline-control"
        onClick={onJumpTop}
        aria-label={t("desktop.im.jumpTop")}
        title={t("desktop.im.jumpTop")}
      >
        <ThemeIcon name="arrow-up" size={11} aria-hidden="true" />
      </button>
      <div className="im-timeline-track" role="navigation">
        {nodes.map((node) => {
          const isActive = activeMessageId === node.messageId;
          return (
            <button
              key={node.messageId}
              type="button"
              className={`im-timeline-node${isActive ? " is-active" : ""}${node.isUser ? " is-user" : " is-role"}`}
              style={node.roleColor ? { "--im-role-color": node.roleColor } as CSSProperties : undefined}
              onClick={() => onJump(node.messageId)}
              onMouseEnter={(event) => {
                const target = event.currentTarget;
                const container = target.closest<HTMLElement>(".im-timeline");
                if (container) {
                  const targetRect = target.getBoundingClientRect();
                  const containerRect = container.getBoundingClientRect();
                  const relTop = targetRect.top - containerRect.top + targetRect.height / 2;
                  const clampedTop = Math.max(30, Math.min(containerRect.height - 30, relTop));
                  setHoverTop(clampedTop);
                }
                setHoveredNode(node);
              }}
              aria-label={`${node.authorLabel} (${node.timeLabel})`}
            >
              <span className="im-timeline-dot">
                {!node.isUser ? (
                  <span className="im-timeline-node-avatar" aria-hidden="true">
                    {node.authorInitial}
                  </span>
                ) : null}
              </span>
            </button>
          );
        })}
      </div>
      {hoveredNode && (
        <div
          className="im-timeline-popover"
          role="tooltip"
          style={{ top: hoverTop }}
        >
          <div className="im-timeline-popover-head">
            <span
              className="im-timeline-popover-badge"
              style={hoveredNode.roleColor ? { "--im-role-color": hoveredNode.roleColor } as CSSProperties : undefined}
            >
              {hoveredNode.authorInitial}
            </span>
            <strong className="im-timeline-popover-author">{hoveredNode.authorLabel}</strong>
            <span className="im-timeline-popover-time">
              {hoveredNode.dateLabel} {hoveredNode.timeLabel}
            </span>
          </div>
          <p className="im-timeline-popover-snippet">{hoveredNode.snippet}</p>
          {hoveredNode.filesChangedCount ? (
            <div className="im-timeline-popover-files">
              <ThemeIcon name="file-text" size={11} aria-hidden="true" />
              <span>
                {hoveredNode.filesChangedCount === 1
                  ? t("desktop.im.fileModifiedSingle")
                  : t("desktop.im.filesModified", hoveredNode.filesChangedCount)}
              </span>
            </div>
          ) : null}
        </div>
      )}
      <button
        type="button"
        className="im-timeline-control"
        onClick={onJumpBottom}
        aria-label={t("desktop.im.jumpBottom")}
        title={t("desktop.im.jumpBottom")}
      >
        <ThemeIcon name="arrow-down" size={11} aria-hidden="true" />
      </button>
    </aside>
  );
}
