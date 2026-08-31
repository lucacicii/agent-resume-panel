import type { ImJob, ImMember, ImMessage } from "../../../shared/imTypes";

export interface TimelineNode {
  messageId: string;
  timestamp: number;
  timeLabel: string;
  dateLabel: string;
  authorLabel: string;
  authorInitial: string;
  roleColor?: string;
  kind: string;
  snippet: string;
  isUser: boolean;
  filesChangedCount?: number;
}

export function cleanSnippet(body: string, max = 160): string {
  const plain = body
    .replace(/```[\s\S]*?```/g, " [code] ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/#+\s+/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_~>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (plain.length <= max) return plain;
  return `${plain.slice(0, max - 1)}…`;
}

export function buildTimelineNodes(
  messages: ImMessage[],
  members: ImMember[],
  roleColorFn: (templateId: string) => string,
  memberLabelFn: (member: ImMember) => string,
  roleInitialFn: (label: string) => string,
  formatTimeFn: (ms: number) => string,
  formatDayFn: (ms: number) => string,
  jobs?: ImJob[]
): TimelineNode[] {
  const memberById = new Map(members.map((m) => [m.memberId, m]));
  const jobById = new Map(jobs?.map((j) => [j.jobId, j]) ?? []);
  return messages
    .filter((msg) => msg.kind === "human" || msg.kind === "role.say")
    .map((msg) => {
      const isUser = msg.kind === "human";
      const member = msg.authorMemberId
        ? (memberById.get(msg.authorMemberId) || members.find((m) => m.templateId === msg.authorMemberId))
        : members.find((m) => m.name === msg.authorLabel || memberLabelFn(m) === msg.authorLabel || m.templateId === msg.authorLabel);
      const authorLabel = member ? memberLabelFn(member) : msg.authorLabel;
      const authorInitial = roleInitialFn(authorLabel);
      const color = isUser
        ? undefined
        : (member ? roleColorFn(member.templateId) : roleColorFn(msg.authorMemberId || msg.authorLabel || "Role"));
      const job = msg.jobId ? jobById.get(msg.jobId) : undefined;
      const filesChangedCount = job?.filesChanged?.length || undefined;
      return {
        messageId: msg.messageId,
        timestamp: msg.createdAtMs,
        timeLabel: formatTimeFn(msg.createdAtMs),
        dateLabel: formatDayFn(msg.createdAtMs),
        authorLabel,
        authorInitial,
        roleColor: color,
        kind: msg.kind,
        snippet: cleanSnippet(msg.body),
        isUser,
        filesChangedCount
      };
    });
}
