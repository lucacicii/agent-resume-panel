export const GTD_STATUSES = ["inbox", "next", "waiting", "someday", "reference"] as const;
export type GtdStatus = (typeof GTD_STATUSES)[number];

export function isGtdStatus(value: string): value is GtdStatus {
  return (GTD_STATUSES as readonly string[]).includes(value);
}

export interface GtdProposal {
  provider: string;
  sessionId: string;
  gtd: GtdStatus;
  reason: string;
  tasks: string[];
  sourceReportIds: string[];
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
