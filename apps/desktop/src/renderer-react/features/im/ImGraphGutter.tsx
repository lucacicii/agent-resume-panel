import { memo, type CSSProperties, type JSX } from "react";
import type { MessageGraphMeta } from "./imTranscriptGraphModel";

export interface ImGraphGutterProps {
  meta?: MessageGraphMeta;
  roleColor?: string;
  isHuman?: boolean;
  isActive?: boolean;
}

const LANE_WIDTH = 24;
const ANCHOR_Y = 16;
const RADIUS = 8;

export const ImGraphGutter = memo(function ImGraphGutter({
  meta,
  roleColor = "#888",
  isHuman = false,
  isActive = false
}: ImGraphGutterProps): JSX.Element {
  if (!meta || (meta.depth === 0 && !meta.hasOutgoingBranches)) {
    return <div className="im-graph-gutter depth-0" aria-hidden="true" style={{ width: 0 }} />;
  }

  if (meta.depth === 0 && meta.hasOutgoingBranches) {
    // Root prompt with outgoing branches: vertical trunk going down from center
    const currentX = 12;
    return (
      <div className="im-graph-gutter depth-0 has-children" aria-hidden="true" style={{ width: 24 }}>
        <svg className="im-graph-svg" width={24} height="100%" preserveAspectRatio="none">
          {/* Trunk down */}
          <line
            x1={currentX}
            y1={ANCHOR_Y}
            x2={currentX}
            y2="100%"
            className="im-graph-trunk-line is-outgoing"
          />
          {/* Port Anchor */}
          <circle
            cx={currentX}
            cy={ANCHOR_Y}
            r={5}
            className="im-graph-port-circle is-root"
          />
          <circle
            cx={currentX}
            cy={ANCHOR_Y}
            r={2.5}
            fill="currentColor"
          />
        </svg>
      </div>
    );
  }

  const depth = meta.depth;
  const totalWidth = depth * LANE_WIDTH + 24;
  const currentX = depth * LANE_WIDTH + 12;
  const parentX = Math.max(12, (depth - 1) * LANE_WIDTH + 12);

  // SVG smooth branch path from parent trunk to current anchor
  const branchPath = `M ${parentX} 0 V ${ANCHOR_Y - RADIUS} Q ${parentX} ${ANCHOR_Y} ${parentX + RADIUS} ${ANCHOR_Y} H ${currentX}`;

  const style = {
    "--im-graph-color": isHuman ? "var(--color-label-tertiary, #777)" : roleColor
  } as CSSProperties;

  return (
    <div
      className={`im-graph-gutter depth-${depth}${isActive ? " is-active" : ""}`}
      style={{ width: totalWidth, ...style }}
      aria-hidden="true"
    >
      <svg className="im-graph-svg" width={totalWidth} height="100%" preserveAspectRatio="none">
        {/* Pass-through vertical trunk lines from previous ancestor depths */}
        {meta.activeTrunkDepths.map((d) => {
          if (d >= depth) return null;
          const trunkX = d * LANE_WIDTH + 12;
          return (
            <line
              key={`trunk-${d}`}
              x1={trunkX}
              y1={0}
              x2={trunkX}
              y2="100%"
              className="im-graph-trunk-line"
            />
          );
        })}

        {/* Incoming branch curve from parent */}
        {depth > 0 && (
          <path
            d={branchPath}
            className="im-graph-branch-curve"
            fill="none"
          />
        )}

        {/* Outgoing trunk line if this node has child branches */}
        {meta.hasOutgoingBranches && (
          <line
            x1={currentX}
            y1={ANCHOR_Y}
            x2={currentX}
            y2="100%"
            className="im-graph-trunk-line is-outgoing"
          />
        )}

        {/* Port Node Anchor Dot */}
        <circle
          cx={currentX}
          cy={ANCHOR_Y}
          r={isActive ? 6 : 4.5}
          className={`im-graph-port-circle${isActive ? " is-active" : ""}`}
        />
        {isActive && (
          <circle
            cx={currentX}
            cy={ANCHOR_Y}
            r={9}
            className="im-graph-pulse-ring"
          />
        )}
      </svg>
    </div>
  );
});
