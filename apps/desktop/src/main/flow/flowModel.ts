import type { FlowDefinition, FlowRun } from "../../shared/flowTypes";

export function validateFlowDag(
  nodes: Array<{ nodeId: string }>,
  edges: Array<{ sourceNodeId: string; targetNodeId: string }>
): void {
  const ids = new Set(nodes.map((node) => node.nodeId));
  const incoming = new Map(nodes.map((node) => [node.nodeId, 0]));
  const next = new Map<string, string[]>();

  for (const edge of edges) {
    if (!ids.has(edge.sourceNodeId) || !ids.has(edge.targetNodeId)) {
      throw new Error("Flow edge references a missing node.");
    }
    if (edge.sourceNodeId === edge.targetNodeId) {
      throw new Error("A Flow node cannot depend on itself.");
    }
    incoming.set(edge.targetNodeId, (incoming.get(edge.targetNodeId) || 0) + 1);
    next.set(edge.sourceNodeId, [...(next.get(edge.sourceNodeId) || []), edge.targetNodeId]);
  }

  const queue = [...incoming].filter(([, count]) => count === 0).map(([id]) => id);
  let visited = 0;
  while (queue.length) {
    const id = queue.shift()!;
    visited += 1;
    for (const target of next.get(id) || []) {
      const count = (incoming.get(target) || 0) - 1;
      incoming.set(target, count);
      if (count === 0) queue.push(target);
    }
  }

  if (visited !== nodes.length) {
    throw new Error("Flow graph must be acyclic.");
  }
}

export function chooseReadyFlowNodeId(flow: FlowDefinition, run: FlowRun): string | undefined {
  const statuses = new Map(run.nodes.map((node) => [node.nodeId, node.status]));
  return [...flow.nodes]
    .sort((a, b) => a.priority - b.priority || a.positionY - b.positionY || a.createdAtMs - b.createdAtMs)
    .find((node) => {
      if (statuses.get(node.nodeId) !== "idle" && statuses.get(node.nodeId) !== "ready") {
        return false;
      }
      const predecessors = flow.edges
        .filter((edge) => edge.targetNodeId === node.nodeId)
        .map((edge) => edge.sourceNodeId);
      return predecessors.every((id) => statuses.get(id) === "completed" || statuses.get(id) === "skipped");
    })?.nodeId;
}
