import { useEffect, useRef, useState, type CSSProperties, type JSX } from "react";
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
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [hoverTop, setHoverTop] = useState<number>(0);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const prevNodesCountRef = useRef<number>(0);

  // Auto-scroll timeline track to the bottom for long conversations
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const count = nodes.length;
    const isInitial = prevNodesCountRef.current === 0;
    prevNodesCountRef.current = count;

    if (isInitial) {
      track.scrollTop = track.scrollHeight;
    } else if (count > 0) {
      // If user is near bottom or active message is at the end, maintain bottom scroll
      const isNearBottom = track.scrollHeight - track.scrollTop - track.clientHeight < 40;
      if (isNearBottom || !activeMessageId) {
        track.scrollTop = track.scrollHeight;
      }
    }
  }, [activeMessageId, nodes.length]);

  // Keep active timeline node in view when activeMessageId changes
  useEffect(() => {
    const track = trackRef.current;
    if (!track || !activeMessageId) return;
    const activeEl = track.querySelector<HTMLElement>(".im-timeline-node.is-active");
    if (activeEl && typeof activeEl.scrollIntoView === "function") {
      activeEl.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [activeMessageId]);

  if (nodes.length < 3) return null;

  return (
    <aside
      className="im-timeline"
      aria-label={t("desktop.im.timeline")}
      onMouseLeave={() => {
        setHoveredNode(null);
        setHoveredIndex(null);
      }}
    >
      <button
        type="button"
        className="im-timeline-control"
        onClick={onJumpTop}
        aria-label={t("desktop.im.jumpTop")}
        title={t("desktop.im.jumpTop")}
      >
        <ThemeIcon name="arrow-up" size={11} aria-hidden="true" />
      </button>
      <div
        ref={trackRef}
        className="im-timeline-track"
        role="navigation"
        onMouseLeave={() => {
          setHoveredNode(null);
          setHoveredIndex(null);
        }}
      >
        {nodes.map((node, index) => {
          const isActive = activeMessageId === node.messageId;
          const distance = hoveredIndex !== null ? Math.abs(index - hoveredIndex) : null;

          // macOS Dock magnification wave effect
          let dockScale = 1;
          let dockOffsetX = 0;
          let zIndex = isActive ? 2 : 1;
          let dockClass = "";

          if (distance === 0) {
            dockScale = 1.85;
            dockOffsetX = -3;
            zIndex = 10;
            dockClass = " is-dock-focused";
          } else if (distance === 1) {
            dockScale = 1.4;
            dockOffsetX = -1.5;
            zIndex = 5;
            dockClass = " is-dock-neighbor-1";
          } else if (distance === 2) {
            dockScale = 1.15;
            dockOffsetX = -0.5;
            zIndex = 3;
            dockClass = " is-dock-neighbor-2";
          }

          const nodeStyle: CSSProperties = {
            ...(node.roleColor ? { "--im-role-color": node.roleColor } : {}),
            "--im-dock-scale": dockScale,
            "--im-dock-offset-x": `${dockOffsetX}px`,
            zIndex
          } as CSSProperties;

          return (
            <button
              key={node.messageId}
              type="button"
              className={`im-timeline-node${isActive ? " is-active" : ""}${node.isUser ? " is-user" : " is-role"}${dockClass}`}
              style={nodeStyle}
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
                setHoveredIndex(index);
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
