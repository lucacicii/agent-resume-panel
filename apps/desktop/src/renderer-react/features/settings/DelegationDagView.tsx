import { useMemo, useRef, useState, type CSSProperties, type JSX } from "react";
import dagre from "@dagrejs/dagre";
import { line, curveBasis } from "d3-shape";
import { isBuiltinTemplateId, isProjectRoleTemplateId, type ImRoleTemplate } from "../../../shared/imTypes";
import { roleColor, roleInitial, type Translate } from "../im/imUtils";
import { ThemeIcon } from "../../components/ThemeIcon";

interface DelegationDagViewProps {
  templates: ImRoleTemplate[];
  t: Translate;
  onSelectTemplate?: (templateId: string) => void;
}

interface DagNode {
  id: string;
  template: ImRoleTemplate;
  x: number;
  y: number;
}

interface DagEdge {
  from: string;
  to: string;
  isAuto: boolean;
  isCycle: boolean;
  basePoints: Array<{ x: number; y: number }>;
}

const CARD_WIDTH = 190;
const CARD_HEIGHT = 74;

const curveLineGenerator = line<{ x: number; y: number }>()
  .x((d) => d.x)
  .y((d) => d.y)
  .curve(curveBasis);

export function findCycleEdges(nodes: Array<{ id: string; edges: string[] }>): Set<string> {
  const cycleEdges = new Set<string>();
  const adj = new Map<string, string[]>();
  for (const n of nodes) adj.set(n.id, n.edges);

  const visited = new Set<string>();
  const inStack = new Set<string>();
  const path: string[] = [];

  function dfs(u: string) {
    visited.add(u);
    inStack.add(u);
    path.push(u);

    const neighbors = adj.get(u) ?? [];
    for (const v of neighbors) {
      if (!visited.has(v)) {
        dfs(v);
      } else if (inStack.has(v)) {
        const cycleStart = path.indexOf(v);
        if (cycleStart !== -1) {
          for (let i = cycleStart; i < path.length; i++) {
            const from = path[i]!;
            const to = i + 1 < path.length ? path[i + 1]! : v;
            cycleEdges.add(`${from}->${to}`);
          }
        }
      }
    }

    path.pop();
    inStack.delete(u);
  }

  for (const n of nodes) {
    if (!visited.has(n.id)) dfs(n.id);
  }
  return cycleEdges;
}

export function DelegationDagView({
  templates,
  t,
  onSelectTemplate
}: DelegationDagViewProps): JSX.Element {
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [hoveredEdgeKey, setHoveredEdgeKey] = useState<string | null>(null);
  const [nodeOffsets, setNodeOffsets] = useState<Record<string, { x: number; y: number }>>({});
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);

  const dragRef = useRef<{
    nodeId: string;
    startX: number;
    startY: number;
    origOffsetX: number;
    origOffsetY: number;
    hasMoved: boolean;
  } | null>(null);

  // 1. Base Dagre Layout
  const { baseNodes, baseEdges, width, height, hasCycles } = useMemo(() => {
    if (!templates.length) {
      return { baseNodes: [], baseEdges: [], width: 700, height: 440, hasCycles: false };
    }

    const g = new dagre.graphlib.Graph();
    g.setGraph({
      rankdir: "LR",
      align: "UL",
      nodesep: 44,
      ranksep: 90,
      marginx: 40,
      marginy: 40
    });
    g.setDefaultEdgeLabel(() => ({}));

    for (const tpl of templates) {
      g.setNode(tpl.templateId, {
        width: CARD_WIDTH,
        height: CARD_HEIGHT
      });
    }

    for (const caller of templates) {
      for (const calleeId of caller.callableTemplateIds ?? []) {
        if (templates.some((t) => t.templateId === calleeId)) {
          g.setEdge(caller.templateId, calleeId);
        }
      }
    }

    dagre.layout(g);

    const calculatedNodes: DagNode[] = [];
    for (const tpl of templates) {
      const nodeInfo = g.node(tpl.templateId);
      if (nodeInfo) {
        calculatedNodes.push({
          id: tpl.templateId,
          template: tpl,
          x: nodeInfo.x - CARD_WIDTH / 2,
          y: nodeInfo.y - CARD_HEIGHT / 2
        });
      }
    }

    const cycleSet = findCycleEdges(
      templates.map((tpl) => ({
        id: tpl.templateId,
        edges: (tpl.callableTemplateIds ?? []).filter((id) => templates.some((t) => t.templateId === id))
      }))
    );

    const calculatedEdges: DagEdge[] = [];
    for (const caller of templates) {
      for (const calleeId of caller.callableTemplateIds ?? []) {
        if (!templates.some((t) => t.templateId === calleeId)) continue;
        const edgeInfo = g.edge(caller.templateId, calleeId);
        if (!edgeInfo || !edgeInfo.points?.length) continue;

        calculatedEdges.push({
          from: caller.templateId,
          to: calleeId,
          isAuto: Boolean(caller.autoDispatch),
          isCycle: cycleSet.has(`${caller.templateId}->${calleeId}`),
          basePoints: edgeInfo.points
        });
      }
    }

    const graphInfo = g.graph();
    const totalWidth = Math.max((graphInfo.width || 700) + 80, 720);
    const totalHeight = Math.max((graphInfo.height || 440) + 80, 440);

    return {
      baseNodes: calculatedNodes,
      baseEdges: calculatedEdges,
      width: totalWidth,
      height: totalHeight,
      hasCycles: cycleSet.size > 0
    };
  }, [templates]);

  // 2. Compute effective positions (base + drag offsets)
  const currentNodes = useMemo(() => {
    return baseNodes.map((node) => {
      const offset = nodeOffsets[node.id] || { x: 0, y: 0 };
      return {
        ...node,
        x: node.x + offset.x,
        y: node.y + offset.y
      };
    });
  }, [baseNodes, nodeOffsets]);

  const nodeMap = useMemo(() => new Map(currentNodes.map((n) => [n.id, n])), [currentNodes]);

  // 3. Compute effective edge curves dynamically
  const currentEdges = useMemo(() => {
    return baseEdges.map((edge) => {
      const src = nodeMap.get(edge.from);
      const tgt = nodeMap.get(edge.to);
      const isSrcMoved = Boolean(nodeOffsets[edge.from]);
      const isTgtMoved = Boolean(nodeOffsets[edge.to]);

      if (!isSrcMoved && !isTgtMoved && edge.basePoints.length > 0) {
        const pathD = curveLineGenerator(edge.basePoints) || "";
        const midPoint = edge.basePoints[Math.floor(edge.basePoints.length / 2)] ?? edge.basePoints[0]!;
        return {
          ...edge,
          pathD,
          midX: midPoint.x,
          midY: midPoint.y
        };
      }

      if (!src || !tgt) {
        return {
          ...edge,
          pathD: "",
          midX: 0,
          midY: 0
        };
      }

      // Dynamic Bezier between moved nodes
      const x1 = src.x + CARD_WIDTH;
      const y1 = src.y + CARD_HEIGHT / 2;
      const x2 = tgt.x;
      const y2 = tgt.y + CARD_HEIGHT / 2;

      let pathD = "";
      if (x2 > x1) {
        const dx = Math.max(30, (x2 - x1) * 0.5);
        pathD = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
      } else {
        const dx = Math.max(40, (x1 - x2) * 0.5);
        pathD = `M ${src.x} ${y1} C ${src.x - dx} ${y1}, ${tgt.x + CARD_WIDTH + dx} ${y2}, ${tgt.x + CARD_WIDTH} ${y2}`;
      }

      return {
        ...edge,
        pathD,
        midX: (x1 + x2) / 2,
        midY: (y1 + y2) / 2
      };
    });
  }, [baseEdges, nodeMap, nodeOffsets]);

  const activeFocusId = hoveredNodeId || selectedNodeId;

  const activeOutgoingTargets = useMemo(() => {
    if (!activeFocusId) return new Set<string>();
    const targets = new Set<string>();
    for (const edge of currentEdges) {
      if (edge.from === activeFocusId) targets.add(edge.to);
    }
    return targets;
  }, [activeFocusId, currentEdges]);

  const activeIncomingSources = useMemo(() => {
    if (!activeFocusId) return new Set<string>();
    const sources = new Set<string>();
    for (const edge of currentEdges) {
      if (edge.to === activeFocusId) sources.add(edge.from);
    }
    return sources;
  }, [activeFocusId, currentEdges]);

  // Drag Event Handlers
  const handlePointerDown = (e: React.PointerEvent<SVGGElement>, nodeId: string) => {
    if (e.button !== undefined && e.button !== 0) return;
    const currentOffset = nodeOffsets[nodeId] || { x: 0, y: 0 };
    const clientX = e.clientX ?? 0;
    const clientY = e.clientY ?? 0;
    dragRef.current = {
      nodeId,
      startX: clientX,
      startY: clientY,
      origOffsetX: currentOffset.x,
      origOffsetY: currentOffset.y,
      hasMoved: false
    };
    setDraggingNodeId(nodeId);
    try {
      if (typeof (e.currentTarget as any).setPointerCapture === "function") {
        (e.currentTarget as any).setPointerCapture(e.pointerId);
      }
    } catch {}
  };

  const handlePointerMove = (e: React.PointerEvent<SVGGElement | SVGSVGElement>) => {
    if (!dragRef.current) return;
    const clientX = e.clientX ?? 0;
    const clientY = e.clientY ?? 0;
    const dx = clientX - dragRef.current.startX;
    const dy = clientY - dragRef.current.startY;
    if (!dragRef.current.hasMoved && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) {
      dragRef.current.hasMoved = true;
    }
    if (dragRef.current.hasMoved) {
      const nextX = dragRef.current.origOffsetX + dx;
      const nextY = dragRef.current.origOffsetY + dy;
      const draggedId = dragRef.current.nodeId;
      setNodeOffsets((prev) => ({
        ...prev,
        [draggedId]: { x: nextX, y: nextY }
      }));
    }
  };

  const handlePointerUp = (e: React.PointerEvent<SVGGElement | SVGSVGElement>) => {
    if (!dragRef.current) return;
    const hasMoved = dragRef.current.hasMoved;
    const nodeId = dragRef.current.nodeId;
    dragRef.current = null;
    setDraggingNodeId(null);
    try {
      if (typeof (e.currentTarget as any).releasePointerCapture === "function") {
        (e.currentTarget as any).releasePointerCapture(e.pointerId);
      }
    } catch {}

    if (!hasMoved) {
      setSelectedNodeId((cur) => (cur === nodeId ? null : nodeId));
      onSelectTemplate?.(nodeId);
    }
  };

  const isLayoutCustomized = Object.keys(nodeOffsets).length > 0;

  return (
    <div className="delegation-dag-container">
      <div className="delegation-dag-toolbar">
        <div className="delegation-dag-legend">
          <span className="dag-legend-item">
            <span className="dag-legend-line is-normal" />
            <span>{t("desktop.settings.imDelegationApproveFirst", "Approve & Dispatch")}</span>
          </span>
          <span className="dag-legend-item">
            <span className="dag-legend-line is-auto" />
            <span>⚡ {t("desktop.settings.imDelegationAuto", "Auto-Dispatch")}</span>
          </span>
          {hasCycles && (
            <span
              className="dag-legend-item is-cycle-alert"
              title={t("desktop.settings.imLoopWarningTooltip", "Cycles will safely pause for user confirmation at runtime")}
            >
              <ThemeIcon name="message-square-warning" size={13} aria-hidden="true" />
              <span>{t("desktop.settings.imLoopDetected", "Loop Detected (Protected)")}</span>
            </span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          {isLayoutCustomized && (
            <button
              type="button"
              className="ghost-btn tiny"
              onClick={() => setNodeOffsets({})}
              title={t("desktop.settings.imResetLayout", "Reset Layout")}
            >
              <ThemeIcon name="refresh" size={11} aria-hidden="true" />
              <span>{t("desktop.settings.imResetLayout", "Reset Layout")}</span>
            </button>
          )}
          <span className="settings-footnote" style={{ margin: 0, fontSize: "11px" }}>
            {activeFocusId
              ? `${t("desktop.settings.imOutgoingCount", `→ ${activeOutgoingTargets.size} callees`, activeOutgoingTargets.size)} · ← ${activeIncomingSources.size} callers`
              : t("desktop.settings.imDagHoverHint", "Hover or click a role to inspect delegation paths")}
          </span>
        </div>
      </div>

      <div className="delegation-dag-canvas-wrap">
        <svg
          className="delegation-dag-svg"
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        >
          <defs>
            <marker
              id="dag-arrow-default"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="var(--color-label-tertiary, #888)" />
            </marker>
            <marker
              id="dag-arrow-outgoing"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#10b981" />
            </marker>
            <marker
              id="dag-arrow-incoming"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#8b5cf6" />
            </marker>
            <marker
              id="dag-arrow-cycle"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#f59e0b" />
            </marker>
          </defs>

          {/* Render Connection Edges via Dagre curve splines */}
          {currentEdges.map((edge) => {
            const edgeKey = `${edge.from}->${edge.to}`;
            const isOutgoing = activeFocusId === edge.from;
            const isIncoming = activeFocusId === edge.to;
            const isEdgeHovered = hoveredEdgeKey === edgeKey;
            const isHighlighted = isOutgoing || isIncoming || isEdgeHovered;
            const isDimmed = activeFocusId ? !isHighlighted : false;

            let strokeColor = "var(--color-separator, #555)";
            let markerId = "dag-arrow-default";
            let strokeWidth = 1.4;

            if (edge.isCycle) {
              strokeColor = "#f59e0b";
              markerId = "dag-arrow-cycle";
              strokeWidth = isHighlighted ? 2.8 : 1.8;
            } else if (isOutgoing) {
              strokeColor = "#10b981";
              markerId = "dag-arrow-outgoing";
              strokeWidth = 2.6;
            } else if (isIncoming) {
              strokeColor = "#8b5cf6";
              markerId = "dag-arrow-incoming";
              strokeWidth = 2.4;
            } else if (edge.isAuto) {
              strokeColor = "#10b98199";
              markerId = "dag-arrow-outgoing";
            }

            return (
              <g key={edgeKey} className="dag-edge-group">
                {/* Wider invisible stroke for easy hovering */}
                <path
                  d={edge.pathD}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={14}
                  style={{ cursor: "pointer" }}
                  onMouseEnter={() => setHoveredEdgeKey(edgeKey)}
                  onMouseLeave={() => setHoveredEdgeKey(null)}
                />
                {/* Visible Dagre smooth spline */}
                <path
                  d={edge.pathD}
                  fill="none"
                  stroke={strokeColor}
                  strokeWidth={strokeWidth}
                  strokeDasharray={edge.isAuto ? "4 3" : undefined}
                  markerEnd={`url(#${markerId})`}
                  opacity={isDimmed ? 0.08 : isHighlighted ? 1 : 0.45}
                  className={`dag-edge${edge.isCycle ? " is-cycle" : ""}${isHighlighted ? " is-highlighted" : ""}`}
                  style={{
                    pointerEvents: "none",
                    transition: "opacity 0.18s ease, stroke-width 0.18s ease"
                  }}
                />
                {/* Tooltip Pill on Edge Hover */}
                {isEdgeHovered && (
                  <g transform={`translate(${edge.midX}, ${edge.midY - 14})`}>
                    <rect
                      x={-70}
                      y={-10}
                      width={140}
                      height={20}
                      rx={10}
                      fill="var(--color-elevated-bg, #222)"
                      stroke="var(--color-separator, #555)"
                      strokeWidth={1}
                    />
                    <text
                      x={0}
                      y={4}
                      textAnchor="middle"
                      fill="var(--color-label-primary, #fff)"
                      fontSize="9.5"
                      fontWeight="500"
                    >
                      {`${nodeMap.get(edge.from)?.template.name || edge.from} → ${nodeMap.get(edge.to)?.template.name || edge.to}`}
                    </text>
                  </g>
                )}
              </g>
            );
          })}

          {/* Render Draggable Node Cards */}
          {currentNodes.map((node) => {
            const color = roleColor(node.template.templateId);
            const isProject = node.template.source === "project" || isProjectRoleTemplateId(node.template.templateId);
            const isBuiltin = isBuiltinTemplateId(node.template.templateId);
            const isTarget = activeOutgoingTargets.has(node.id);
            const isSource = activeIncomingSources.has(node.id);
            const isSelf = activeFocusId === node.id;
            const isDragging = draggingNodeId === node.id;
            const isDimmed = activeFocusId ? !isSelf && !isTarget && !isSource : false;

            let cardBorder = "var(--color-separator, #333)";
            let cardBg = "var(--color-window-bg, #1a1a1a)";

            if (isSelf || isDragging) {
              cardBorder = "var(--color-accent, #0070f3)";
              cardBg = "color-mix(in srgb, var(--color-accent, #0070f3) 8%, var(--color-window-bg, #1a1a1a))";
            } else if (isTarget) {
              cardBorder = "#10b981";
              cardBg = "color-mix(in srgb, #10b981 8%, var(--color-window-bg, #1a1a1a))";
            } else if (isSource) {
              cardBorder = "#8b5cf6";
              cardBg = "color-mix(in srgb, #8b5cf6 8%, var(--color-window-bg, #1a1a1a))";
            }

            return (
              <g
                key={node.id}
                transform={`translate(${node.x}, ${node.y})`}
                className={`dag-node-group${isSelf ? " is-self" : ""}${isDragging ? " is-dragging" : ""}${isTarget ? " is-target" : ""}${isSource ? " is-source" : ""}`}
                style={{
                  opacity: isDimmed ? 0.25 : 1,
                  cursor: isDragging ? "grabbing" : "grab",
                  userSelect: "none",
                  touchAction: "none"
                }}
                onPointerDown={(e) => handlePointerDown(e, node.id)}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
                onMouseEnter={() => !draggingNodeId && setHoveredNodeId(node.id)}
                onMouseLeave={() => !draggingNodeId && setHoveredNodeId(null)}
              >
                {/* Node Card Container */}
                <rect
                  width={CARD_WIDTH}
                  height={CARD_HEIGHT}
                  rx={8}
                  className="dag-node-card-bg"
                  fill={cardBg}
                  stroke={cardBorder}
                  strokeWidth={isSelf || isDragging || isTarget || isSource ? 2 : 1}
                />

                {/* Left Color Indicator Stripe */}
                <path
                  d={`M 0 8 Q 0 0 8 0 L 8 0 L 8 ${CARD_HEIGHT} L 8 ${CARD_HEIGHT} Q 0 ${CARD_HEIGHT} 0 ${CARD_HEIGHT - 8} Z`}
                  fill={color}
                />

                {/* Avatar Badge */}
                <circle cx={26} cy={26} r={12} fill={color} />
                <text
                  x={26}
                  y={30}
                  textAnchor="middle"
                  fill="#ffffff"
                  fontSize="11"
                  fontWeight="bold"
                >
                  {roleInitial(node.template.name)}
                </text>

                {/* Role Name */}
                <text
                  x={46}
                  y={24}
                  fill="var(--color-label-primary, #ffffff)"
                  fontSize="12.5"
                  fontWeight="600"
                  className="dag-node-title"
                >
                  {node.template.name.length > 13 ? `${node.template.name.slice(0, 12)}…` : node.template.name}
                </text>

                {/* Agent & Model Subtitle */}
                <text
                  x={46}
                  y={40}
                  fill="var(--color-label-tertiary, #888888)"
                  fontSize="10"
                >
                  {node.template.agent.toUpperCase()}
                  {node.template.model ? ` · ${node.template.model.length > 10 ? `${node.template.model.slice(0, 9)}…` : node.template.model}` : ""}
                  {isProject ? " [Repo]" : isBuiltin ? "" : ""}
                </text>

                {/* Auto-Dispatch Badge */}
                {node.template.autoDispatch && (
                  <g transform={`translate(${CARD_WIDTH - 46}, 7)`}>
                    <rect width={38} height={16} rx={4} fill="#10b98122" stroke="#10b981" strokeWidth={0.8} />
                    <text x={19} y={11.5} textAnchor="middle" fill="#10b981" fontSize="9" fontWeight="bold">
                      ⚡Auto
                    </text>
                  </g>
                )}

                {/* Bottom Flow Metrics */}
                <text
                  x={14}
                  y={60}
                  fill="var(--color-label-tertiary, #666666)"
                  fontSize="9.5"
                >
                  {`→ ${(node.template.callableTemplateIds ?? []).length} ${t("desktop.settings.imOutgoingCount", "callees")}`}
                </text>

                {/* Port Anchors */}
                <circle cx={CARD_WIDTH} cy={CARD_HEIGHT / 2} r={3} fill={color} />
                <circle cx={0} cy={CARD_HEIGHT / 2} r={3} fill="var(--color-label-tertiary, #666)" />
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
