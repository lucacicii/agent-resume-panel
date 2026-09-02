import type { ImJob, ImMessage } from "../../../shared/imTypes";

export type GraphTriggerKind =
  | "root_prompt"
  | "auto_routed"
  | "mention"
  | "auto_dispatched"
  | "manual_dispatched"
  | "follow_up"
  | "standalone";

export interface MessageGraphMeta {
  messageId: string;
  parentMessageId: string | null;
  treeRootMessageId: string;
  depth: number;
  triggerKind: GraphTriggerKind;
  triggerReason?: string;
  targetRoleLabel?: string;
  hasOutgoingBranches: boolean;
  isLastBranch: boolean;
  /** Active vertical trunk lines at each depth (for rendering multi-level relationship guides) */
  activeTrunkDepths: number[];
}

export function computeTranscriptGraph(
  messages: ImMessage[],
  jobs: ImJob[] = []
): Map<string, MessageGraphMeta> {
  const metaMap = new Map<string, MessageGraphMeta>();
  if (!messages.length) return metaMap;

  const jobById = new Map(jobs.map((j) => [j.jobId, j]));
  const messageById = new Map(messages.map((m) => [m.messageId, m]));
  const roleSayByJobId = new Map<string, ImMessage>();

  for (const msg of messages) {
    if (msg.kind === "role.say" && msg.jobId) {
      roleSayByJobId.set(msg.jobId, msg);
    }
  }

  interface InternalTreeNode {
    message: ImMessage;
    parentMessageId: string | null;
    treeRootMessageId: string;
    depth: number;
    triggerKind: GraphTriggerKind;
    triggerReason?: string;
    targetRoleLabel?: string;
    children: InternalTreeNode[];
  }

  const attachedMessageIds = new Set<string>();
  const rootTrees: InternalTreeNode[] = [];

  function buildRoleSubtree(
    roleMsg: ImMessage,
    parentMessageId: string,
    treeRootMessageId: string,
    depth: number,
    triggerKind: GraphTriggerKind,
    triggerReason?: string
  ): InternalTreeNode {
    attachedMessageIds.add(roleMsg.messageId);

    const node: InternalTreeNode = {
      message: roleMsg,
      parentMessageId,
      treeRootMessageId,
      depth,
      triggerKind,
      triggerReason,
      children: []
    };

    if (roleMsg.delegationProposals?.length) {
      for (const proposal of roleMsg.delegationProposals) {
        if (proposal.dispatchedJobId) {
          const childMsg = roleSayByJobId.get(proposal.dispatchedJobId);
          if (childMsg && !attachedMessageIds.has(childMsg.messageId)) {
            const childTrigger: GraphTriggerKind =
              proposal.status === "auto_dispatched" ? "auto_dispatched" : "manual_dispatched";
            node.children.push(
              buildRoleSubtree(
                childMsg,
                roleMsg.messageId,
                treeRootMessageId,
                depth + 1,
                childTrigger,
                proposal.reason
              )
            );
          }
        }
      }
    }

    return node;
  }

  // 1. Process human messages as roots
  for (const msg of messages) {
    if (msg.kind === "human") {
      attachedMessageIds.add(msg.messageId);
      const rootNode: InternalTreeNode = {
        message: msg,
        parentMessageId: null,
        treeRootMessageId: msg.messageId,
        depth: 0,
        triggerKind: "root_prompt",
        children: []
      };

      // Find direct children
      // Child Case A: msg.jobId matches
      if (msg.jobId) {
        const directRoleMsg = roleSayByJobId.get(msg.jobId);
        if (directRoleMsg && !attachedMessageIds.has(directRoleMsg.messageId)) {
          const trigger: GraphTriggerKind = msg.autoRouted ? "auto_routed" : "mention";
          rootNode.children.push(
            buildRoleSubtree(directRoleMsg, msg.messageId, msg.messageId, 1, trigger)
          );
        }
      }

      // Child Case B: jobs associated directly with msg.messageId
      const directJobs = jobs.filter((j) => j.messageId === msg.messageId);
      for (const dJob of directJobs) {
        const directRoleMsg = roleSayByJobId.get(dJob.jobId);
        if (directRoleMsg && !attachedMessageIds.has(directRoleMsg.messageId)) {
          const trigger: GraphTriggerKind = msg.autoRouted ? "auto_routed" : "mention";
          rootNode.children.push(
            buildRoleSubtree(directRoleMsg, msg.messageId, msg.messageId, 1, trigger)
          );
        }
      }

      // Child Case C: same threadId messages not yet attached
      if (msg.threadId) {
        const threadRoleMsgs = messages.filter(
          (m) =>
            m.kind === "role.say" &&
            m.threadId === msg.threadId &&
            !attachedMessageIds.has(m.messageId)
        );
        for (const tRoleMsg of threadRoleMsgs) {
          rootNode.children.push(
            buildRoleSubtree(tRoleMsg, msg.messageId, msg.messageId, 1, "follow_up")
          );
        }
      }

      rootTrees.push(rootNode);
    }
  }

  // 2. Process any remaining unattached role messages as independent roots
  for (const msg of messages) {
    if (!attachedMessageIds.has(msg.messageId)) {
      if (msg.kind === "role.say") {
        rootTrees.push(buildRoleSubtree(msg, null as unknown as string, msg.messageId, 0, "standalone"));
      } else {
        rootTrees.push({
          message: msg,
          parentMessageId: null,
          treeRootMessageId: msg.messageId,
          depth: 0,
          triggerKind: "standalone",
          children: []
        });
      }
    }
  }

  // 3. Flatten trees to assign active trunks, isLastBranch, hasOutgoingBranches
  function traverse(node: InternalTreeNode, isLastChild: boolean, activeTrunks: number[]) {
    const hasOutgoingBranches = node.children.length > 0;
    const nextTrunks = hasOutgoingBranches ? [...activeTrunks, node.depth] : activeTrunks;

    metaMap.set(node.message.messageId, {
      messageId: node.message.messageId,
      parentMessageId: node.parentMessageId,
      treeRootMessageId: node.treeRootMessageId,
      depth: Math.min(3, node.depth),
      triggerKind: node.triggerKind,
      triggerReason: node.triggerReason,
      hasOutgoingBranches,
      isLastBranch: isLastChild,
      activeTrunkDepths: activeTrunks
    });

    node.children.forEach((child, idx) => {
      const isLast = idx === node.children.length - 1;
      const childTrunks = isLast ? activeTrunks.filter((d) => d !== node.depth) : nextTrunks;
      traverse(child, isLast, childTrunks);
    });
  }

  for (const root of rootTrees) {
    traverse(root, true, []);
  }

  return metaMap;
}
