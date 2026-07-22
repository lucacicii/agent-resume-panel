export const GTD_STATUSES = ["inbox", "next", "waiting", "someday", "reference"] as const;
export type GtdStatus = (typeof GTD_STATUSES)[number];

export function isGtdStatus(value: string): value is GtdStatus {
  return (GTD_STATUSES as readonly string[]).includes(value);
}

export interface GtdEvidenceQuote {
  source: string;
  quote: string;
}

export interface GtdEvidence {
  unresolved: GtdEvidenceQuote;
  nextAction: GtdEvidenceQuote;
}

export interface GtdProposal {
  provider: string;
  sessionId: string;
  gtd: GtdStatus;
  reason: string;
  tasks: string[];
  sourceReportIds: string[];
  /** Required for AI-generated next actions; quotes must be traceable to analysis input. */
  evidence?: GtdEvidence;
}

export interface GtdApplyItem {
  provider: string;
  sessionId: string;
  previousStatus: GtdStatus | null;
  newStatus: GtdStatus;
  reason: string;
  sourceReportIds: string[];
  todolistPath?: string;
  title?: string;
  projectPath?: string;
}
