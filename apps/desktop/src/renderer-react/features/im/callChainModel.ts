import type { ImDelegationProposal, ImJob, ImMember, ImMessage } from "../../../shared/imTypes";
import { cleanSnippet } from "./timelineModel";

export type CallTriggerType =
  | "user_prompt"
  | "auto_routed"
  | "mention"
  | "auto_dispatched"
  | "manual_dispatched"
  | "follow_up"
  | "quote_handoff"
  | "pending_proposal";

export type CallNodeStatus =
  | "completed"
  | "running"
  | "queued"
  | "failed"
  | "cancelled"
  | "pending_proposal"
  | "dismissed_proposal";

export interface CallChainNode {
  id: string;
  messageId: string;
  jobId?: string;
  threadId?: string;
  kind: "human" | "role" | "proposal";
  authorLabel: string;
  templateId?: string;
  roleColor?: string;
  roleInitial: string;
  triggerType: CallTriggerType;
  status?: CallNodeStatus;
  snippet: string;
  reason?: string;
  filesChanged?: string[];
  timestamp: number;
  timeLabel: string;
  children: CallChainNode[];
  depth: number;
}

export interface CallChainGroup {
  chainId: string;
  threadId?: string;
  title: string;
  timestamp: number;
  timeLabel: string;
  dateLabel: string;
  root: CallChainNode;
  totalNodes: number;
  activeCount: number;
  failedCount: number;
  filesChangedCount: number;
}

export interface CallChainSummary {
  chains: CallChainGroup[];
  totalChains: number;
  totalNodes: number;
  activeCount: number;
}

export function buildCallChains(
  messages: ImMessage[],
  jobs: ImJob[],
  members: ImMember[],
  formatters: {
    roleColor: (templateId: string) => string;
    memberLabel: (member: ImMember) => string;
    roleInitial: (label: string) => string;
    formatTime: (ms: number) => string;
    formatDay: (ms: number) => string;
  }
): CallChainSummary {
  if (!messages.length) {
    return { chains: [], totalChains: 0, totalNodes: 0, activeCount: 0 };
  }

  const { roleColor, memberLabel, roleInitial, formatTime, formatDay } = formatters;
  const memberById = new Map(members.map((m) => [m.memberId, m]));
  const memberByTemplate = new Map(members.map((m) => [m.templateId, m]));
  const jobById = new Map(jobs.map((j) => [j.jobId, j]));
  const messageById = new Map(messages.map((m) => [m.messageId, m]));

  function resolveMember(memberIdOrTemplate?: string | null, labelFallback?: string): ImMember | undefined {
    if (!memberIdOrTemplate) {
      if (labelFallback) {
        return members.find((m) => m.name === labelFallback || memberLabel(m) === labelFallback || m.templateId === labelFallback);
      }
      return undefined;
    }
    return memberById.get(memberIdOrTemplate) || memberByTemplate.get(memberIdOrTemplate);
  }

  // 1. Identify human trigger messages as roots
  const humanMessages = messages.filter((m) => m.kind === "human");
  const roleSayMessages = messages.filter((m) => m.kind === "role.say");

  // Map jobs to trigger messages or parent proposals
  // A role message can be triggered directly by a human message (via message.jobId or job.messageId)
  // or via a delegation proposal (proposal.dispatchedJobId === job.jobId).
  const roleSayByJobId = new Map<string, ImMessage>();
  for (const msg of roleSayMessages) {
    if (msg.jobId) roleSayByJobId.set(msg.jobId, msg);
  }

  // Track which role say messages have been attached to a parent node
  const attachedRoleMsgIds = new Set<string>();

  function createRoleNode(
    roleMsg: ImMessage,
    triggerType: CallTriggerType,
    depth: number,
    proposalReason?: string
  ): CallChainNode {
    attachedRoleMsgIds.add(roleMsg.messageId);
    const job = roleMsg.jobId ? jobById.get(roleMsg.jobId) : undefined;
    const member = resolveMember(roleMsg.authorMemberId || job?.memberId, roleMsg.authorLabel);
    const label = member ? memberLabel(member) : roleMsg.authorLabel;
    const templateId = member?.templateId || roleMsg.authorMemberId || "role_developer";
    const color = roleColor(templateId);
    const initial = roleInitial(label);

    let status: CallNodeStatus = "completed";
    if (job) {
      if (job.status === "running" || job.status === "connecting" || job.status === "awaiting_user") {
        status = "running";
      } else if (job.status === "queued") {
        status = "queued";
      } else if (job.status === "failed") {
        status = "failed";
      } else if (job.status === "cancelled") {
        status = "cancelled";
      }
    }

    const node: CallChainNode = {
      id: `node-${roleMsg.messageId}`,
      messageId: roleMsg.messageId,
      jobId: roleMsg.jobId || undefined,
      threadId: roleMsg.threadId || job?.threadId,
      kind: "role",
      authorLabel: label,
      templateId,
      roleColor: color,
      roleInitial: initial,
      triggerType,
      status,
      snippet: cleanSnippet(roleMsg.body),
      reason: proposalReason,
      filesChanged: job?.filesChanged?.length ? job.filesChanged : undefined,
      timestamp: roleMsg.createdAtMs,
      timeLabel: formatTime(roleMsg.createdAtMs),
      children: [],
      depth
    };

    // Recursively attach children from delegation proposals
    if (roleMsg.delegationProposals?.length) {
      for (const proposal of roleMsg.delegationProposals) {
        if (proposal.dispatchedJobId) {
          const childRoleMsg = roleSayByJobId.get(proposal.dispatchedJobId);
          if (childRoleMsg) {
            const childTrigger: CallTriggerType =
              proposal.status === "auto_dispatched" ? "auto_dispatched" : "manual_dispatched";
            node.children.push(createRoleNode(childRoleMsg, childTrigger, depth + 1, proposal.reason));
          } else {
            // Child job exists but role.say message might still be streaming or queued
            const childJob = jobById.get(proposal.dispatchedJobId);
            if (childJob) {
              const childMember = resolveMember(childJob.memberId);
              const childLabel = childMember ? memberLabel(childMember) : proposal.targetRoleName || "Role";
              const childTemplateId = childMember?.templateId || proposal.targetTemplateId;
              const childStatus: CallNodeStatus =
                childJob.status === "running" || childJob.status === "connecting" || childJob.status === "awaiting_user"
                  ? "running"
                  : childJob.status === "queued"
                    ? "queued"
                    : childJob.status === "failed"
                      ? "failed"
                      : "completed";

              node.children.push({
                id: `job-node-${childJob.jobId}`,
                messageId: roleMsg.messageId,
                jobId: childJob.jobId,
                threadId: childJob.threadId,
                kind: "role",
                authorLabel: childLabel,
                templateId: childTemplateId,
                roleColor: roleColor(childTemplateId),
                roleInitial: roleInitial(childLabel),
                triggerType: proposal.status === "auto_dispatched" ? "auto_dispatched" : "manual_dispatched",
                status: childStatus,
                snippet: cleanSnippet(childJob.brief.instruction),
                reason: proposal.reason,
                filesChanged: childJob.filesChanged?.length ? childJob.filesChanged : undefined,
                timestamp: childJob.createdAtMs,
                timeLabel: formatTime(childJob.createdAtMs),
                children: [],
                depth: depth + 1
              });
            }
          }
        } else if (proposal.status === "pending") {
          // Render pending delegation proposal node
          const targetMember = resolveMember(proposal.targetTemplateId);
          const targetLabel = targetMember ? memberLabel(targetMember) : proposal.targetRoleName || "Role";
          const targetTemplateId = targetMember?.templateId || proposal.targetTemplateId;

          node.children.push({
            id: `proposal-${proposal.id}`,
            messageId: roleMsg.messageId,
            threadId: roleMsg.threadId,
            kind: "proposal",
            authorLabel: targetLabel,
            templateId: targetTemplateId,
            roleColor: roleColor(targetTemplateId),
            roleInitial: roleInitial(targetLabel),
            triggerType: "pending_proposal",
            status: "pending_proposal",
            snippet: cleanSnippet(proposal.instruction),
            reason: proposal.reason,
            timestamp: proposal.createdAtMs || roleMsg.createdAtMs,
            timeLabel: formatTime(proposal.createdAtMs || roleMsg.createdAtMs),
            children: [],
            depth: depth + 1
          });
        }
      }
    }

    return node;
  }

  const chains: CallChainGroup[] = [];

  for (const humanMsg of humanMessages) {
    const rootNode: CallChainNode = {
      id: `root-${humanMsg.messageId}`,
      messageId: humanMsg.messageId,
      threadId: humanMsg.threadId,
      kind: "human",
      authorLabel: "You",
      roleInitial: "Y",
      triggerType: "user_prompt",
      status: "completed",
      snippet: cleanSnippet(humanMsg.body),
      timestamp: humanMsg.createdAtMs,
      timeLabel: formatTime(humanMsg.createdAtMs),
      children: [],
      depth: 0
    };

    // Find direct role replies triggered by this human message
    // Case 1: humanMsg.jobId matches
    if (humanMsg.jobId) {
      const directRoleMsg = roleSayByJobId.get(humanMsg.jobId);
      if (directRoleMsg && !attachedRoleMsgIds.has(directRoleMsg.messageId)) {
        const triggerType: CallTriggerType = humanMsg.autoRouted ? "auto_routed" : "mention";
        rootNode.children.push(createRoleNode(directRoleMsg, triggerType, 1));
      }
    }

    // Case 2: Jobs associated with this messageId directly
    const directJobs = jobs.filter((j) => j.messageId === humanMsg.messageId);
    for (const dJob of directJobs) {
      const directRoleMsg = roleSayByJobId.get(dJob.jobId);
      if (directRoleMsg && !attachedRoleMsgIds.has(directRoleMsg.messageId)) {
        const triggerType: CallTriggerType = humanMsg.autoRouted ? "auto_routed" : "mention";
        rootNode.children.push(createRoleNode(directRoleMsg, triggerType, 1));
      } else if (!directRoleMsg && dJob.status !== "cancelled") {
        // Queued or running without persisted role message yet
        const member = resolveMember(dJob.memberId);
        const label = member ? memberLabel(member) : "Role";
        const templateId = member?.templateId || "role_developer";
        const status: CallNodeStatus =
          dJob.status === "running" || dJob.status === "connecting" || dJob.status === "awaiting_user"
            ? "running"
            : dJob.status === "queued"
              ? "queued"
              : dJob.status === "failed"
                ? "failed"
                : "completed";

        rootNode.children.push({
          id: `job-node-${dJob.jobId}`,
          messageId: humanMsg.messageId,
          jobId: dJob.jobId,
          threadId: dJob.threadId,
          kind: "role",
          authorLabel: label,
          templateId,
          roleColor: roleColor(templateId),
          roleInitial: roleInitial(label),
          triggerType: humanMsg.autoRouted ? "auto_routed" : "mention",
          status,
          snippet: cleanSnippet(dJob.brief.instruction),
          filesChanged: dJob.filesChanged?.length ? dJob.filesChanged : undefined,
          timestamp: dJob.createdAtMs,
          timeLabel: formatTime(dJob.createdAtMs),
          children: [],
          depth: 1
        });
      }
    }

    // Case 3: Same threadId messages that haven't been attached yet
    if (humanMsg.threadId) {
      const threadRoleMsgs = roleSayMessages.filter(
        (m) => m.threadId === humanMsg.threadId && !attachedRoleMsgIds.has(m.messageId)
      );
      for (const tRoleMsg of threadRoleMsgs) {
        rootNode.children.push(createRoleNode(tRoleMsg, "follow_up", 1));
      }
    }

    // Count statistics for this chain group
    let totalNodes = 1;
    let activeCount = 0;
    let failedCount = 0;
    const filesSet = new Set<string>();

    function countStats(node: CallChainNode) {
      if (node.status === "running" || node.status === "queued") activeCount++;
      if (node.status === "failed") failedCount++;
      if (node.filesChanged) {
        for (const file of node.filesChanged) filesSet.add(file);
      }
      for (const child of node.children) {
        totalNodes++;
        countStats(child);
      }
    }

    countStats(rootNode);

    chains.push({
      chainId: humanMsg.messageId,
      threadId: humanMsg.threadId,
      title: rootNode.snippet || "(Empty prompt)",
      timestamp: humanMsg.createdAtMs,
      timeLabel: formatTime(humanMsg.createdAtMs),
      dateLabel: formatDay(humanMsg.createdAtMs),
      root: rootNode,
      totalNodes,
      activeCount,
      failedCount,
      filesChangedCount: filesSet.size
    });
  }

  // Any remaining unattached role messages (e.g. standalone system or orphan turns)
  const unattached = roleSayMessages.filter((m) => !attachedRoleMsgIds.has(m.messageId));
  if (unattached.length > 0 && !humanMessages.length) {
    for (const orphanMsg of unattached) {
      const orphanNode = createRoleNode(orphanMsg, "user_prompt", 0);
      chains.push({
        chainId: orphanMsg.messageId,
        threadId: orphanMsg.threadId,
        title: orphanNode.snippet,
        timestamp: orphanMsg.createdAtMs,
        timeLabel: formatTime(orphanMsg.createdAtMs),
        dateLabel: formatDay(orphanMsg.createdAtMs),
        root: orphanNode,
        totalNodes: 1,
        activeCount: orphanNode.status === "running" || orphanNode.status === "queued" ? 1 : 0,
        failedCount: orphanNode.status === "failed" ? 1 : 0,
        filesChangedCount: orphanNode.filesChanged?.length || 0
      });
    }
  }

  const totalChains = chains.length;
  const totalNodes = chains.reduce((acc, c) => acc + c.totalNodes, 0);
  const totalActive = chains.reduce((acc, c) => acc + c.activeCount, 0);

  return {
    chains,
    totalChains,
    totalNodes,
    activeCount: totalActive
  };
}
