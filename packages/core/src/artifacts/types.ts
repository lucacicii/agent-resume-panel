/**
 * UI Artifact and Stage contracts for Universal Chat + Adaptive Stage.
 */

export type ArtifactKind =
  | "native:gtd"
  | "native:notes"
  | "native:browser"
  | "native:diff"
  | "native:workbench"
  | "native:schedule"
  | "native:sessions"
  | "native:memory"
  | "native:scripts"
  | "chart"
  | "graph:mermaid"
  | "stats:kpi"
  | "custom:app";

export type StageTarget = "stage" | "inline" | "drawer";

export type StageView =
  | "none"
  | "gtd"
  | "notes"
  | "schedule"
  | "sessions"
  | "archive"
  | "browser"
  | "artifact";

export interface UIArtifactEnvelope<T = unknown> {
  /** Unique artifact identifier; matching IDs trigger hot in-place update */
  id: string;
  /** Schema version */
  version: "1.0";
  /** Stage tab title */
  title: string;
  /** Associated icon identifier (e.g. 'kanban', 'file-text', 'globe', 'bar-chart-3') */
  icon?: string;
  /** Presentation target */
  target: StageTarget;
  /** Type of artifact */
  kind: ArtifactKind;
  /** Structured payload for native/chart, or source code for custom:app */
  payload: T;
  /** Associated conversation session id, if session-scoped */
  sessionId?: string;
  /** Creation timestamp */
  createdAt?: number;
  /** Capabilities and reverse bridge permissions */
  capabilities?: {
    canDirectMutate?: boolean;
    service?: string;
    exportable?: boolean;
  };
}

export interface StageState {
  view: StageView;
  isOpen: boolean;
  width: number;
  activeArtifactId: string | null;
  artifacts: UIArtifactEnvelope[];
}
