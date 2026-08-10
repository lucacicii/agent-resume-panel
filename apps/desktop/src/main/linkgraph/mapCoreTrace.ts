/**
 * Map shared core link_graph_trace result → Desktop Workbench shapes.
 * Display-only: does not recompute the chain.
 */

import type {
  LinkGraphStep,
  LinkGraphTimelineItem as CoreTimelineItem,
  LinkGraphTraceResult
} from "@agent-resume/core";
import type {
  LinkGraphAnalysis,
  LinkGraphBridgeStatus,
  LinkGraphChainStep,
  LinkGraphEdgeKind,
  LinkGraphHit,
  LinkGraphHopRole,
  LinkGraphNodeKind,
  LinkGraphOpenEnd,
  LinkGraphTimelineItem
} from "../../shared/linkGraphTypes";

const ABSOLUTE_MAX_HITS = 400;

function mapRole(role: string, kind?: string): LinkGraphHopRole {
  if (role === "bridge" || kind === "http_url" || kind === "be_handler") return "bridge";
  if (role === "import" || kind === "api_import") return "import";
  if (role === "call" || kind === "api_call" || kind === "api_method") return "call";
  if (role === "reference" || kind === "reference") return "reference";
  if (role === "definition" || kind === "definition" || kind === "dto_type" || kind === "vo_field") {
    return "definition";
  }
  return "other";
}

function mapEdge(role: string, kind?: string): LinkGraphEdgeKind {
  if (kind === "http_url" || kind === "be_handler" || role === "bridge") return "bridge";
  if (kind === "api_import" || role === "import") return "imports";
  if (kind === "reference" || role === "reference") return "refers";
  if (role === "call") return "refers";
  return "defines";
}

function mapNode(role: string, kind?: string, file?: string): LinkGraphNodeKind {
  if (kind === "vo_field") return "vo_field";
  if (kind === "be_handler" || (file && /\.java$/i.test(file))) return "be_controller";
  if (kind === "api_call" || kind === "api_method" || kind === "api_import" || kind === "http_url") {
    return "api_client";
  }
  if (kind === "reference" || role === "reference") return "reference";
  if (kind === "definition" || kind === "dto_type" || role === "definition") return "definition";
  if (role === "bridge") return "bridge";
  return "unknown";
}

function mapBridgeKind(kind?: string): LinkGraphChainStep["bridgeKind"] {
  if (kind === "http_url") return "api_client";
  if (kind === "be_handler") return "llm_discover";
  if (kind === "api_call" || kind === "api_method" || kind === "api_import") return "api_client";
  if (kind === "vo_field") return "name_family";
  return undefined;
}

export function mapCoreStepToDesktop(step: LinkGraphStep): LinkGraphChainStep {
  return {
    id: step.id,
    edgeKind: mapEdge(step.role, step.kind),
    nodeKind: mapNode(step.role, step.kind, step.file),
    role: mapRole(step.role, step.kind),
    title: step.title,
    narrative: step.narrative,
    file: step.file,
    path: step.path,
    line: step.line,
    symbol: step.symbol,
    preview: step.preview,
    confidence: step.confidence,
    terminal: step.terminal,
    bridgeKind: mapBridgeKind(step.kind)
  };
}

export function mapCoreTimeline(items: CoreTimelineItem[]): LinkGraphTimelineItem[] {
  return items.map((item) => ({
    id: item.id,
    phase: item.phase as LinkGraphTimelineItem["phase"],
    status: item.status,
    title: item.title,
    detail: item.detail,
    evidence: item.evidence,
    at: item.at
  }));
}

export function mapCoreTraceToAnalysis(trace: LinkGraphTraceResult): LinkGraphAnalysis {
  const hops = trace.primaryChain.map((s) => ({
    id: s.id,
    role: mapRole(s.role, s.kind),
    title: s.title,
    narrative: s.narrative || s.preview,
    file: s.file,
    line: s.line,
    confidence: s.confidence,
    bridgeKind: mapBridgeKind(s.kind)
  }));
  return {
    summary: trace.summary,
    complete: trace.bridgeStatus === "ok" && trace.openEnds.length === 0,
    openEnds: trace.openEnds as LinkGraphOpenEnd[],
    hops,
    confidence: trace.facts.hasVoField
      ? "high"
      : trace.facts.hasBackendHandler
        ? "medium"
        : "low"
  };
}

export function mapBridgeStatus(
  status: LinkGraphTraceResult["bridgeStatus"]
): LinkGraphBridgeStatus {
  return status;
}

export function stepsToHits(steps: LinkGraphChainStep[]): LinkGraphHit[] {
  const hits: LinkGraphHit[] = [];
  for (const [index, step] of steps.entries()) {
    hits.push({
      path: step.path,
      relativePath: step.file,
      line: step.line,
      column: step.column || 1,
      endColumn: step.endColumn || (step.column || 1) + Math.max(1, step.symbol.length),
      preview: step.preview,
      depth: index,
      symbol: step.symbol,
      reason: step.bridgeKind ? `bridge:${step.bridgeKind}` : step.edgeKind,
      score: step.confidence === "high" ? 80 : step.confidence === "medium" ? 50 : 25,
      edgeKind: step.edgeKind,
      nodeKind: step.nodeKind,
      bridgeKind: step.bridgeKind,
      confidence: step.confidence
    });
    for (const ref of step.pageRefs || []) {
      hits.push({
        path: step.path,
        relativePath: step.file,
        line: ref.line,
        column: ref.column,
        endColumn: ref.endColumn,
        preview: ref.preview,
        depth: index,
        symbol: step.symbol,
        reason: "page_ref",
        score: 40,
        edgeKind: "refers",
        nodeKind: "reference"
      });
    }
  }
  return hits.slice(0, ABSOLUTE_MAX_HITS);
}
