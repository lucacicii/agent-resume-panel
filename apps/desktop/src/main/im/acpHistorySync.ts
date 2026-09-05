import type { AcpChatMessage, AcpToolCallInfo } from "../acp/types";
import type { ImMessage, ImToolCall } from "./types";

export interface AcpHistorySyncMember {
  memberId: string;
  name: string;
  projectId: string;
}

export type AcpHistorySyncPlan =
  | {
      type: "insert";
      acpMessageId: string;
      body: string;
      thinking?: string;
      toolCalls?: ImToolCall[];
      createdAtMs: number;
    }
  | {
      type: "update";
      messageId: string;
      acpMessageId: string;
      body: string;
      thinking?: string;
      toolCalls?: ImToolCall[];
    };

export function toImToolCalls(toolCalls: AcpToolCallInfo[] | undefined): ImToolCall[] | undefined {
  if (!toolCalls?.length) return undefined;
  const mapped: ImToolCall[] = [];
  for (const call of toolCalls) {
    const toolCallId = call.toolCallId?.trim();
    if (!toolCallId) continue;
    mapped.push({
      toolCallId,
      title: call.title,
      kind: call.kind,
      status: call.status,
      locations: call.locations,
      content: call.content,
      rawInput: call.rawInput,
      rawOutput: call.rawOutput
    });
  }
  return mapped.length ? mapped : undefined;
}

export function isImportableAcpAssistant(message: AcpChatMessage): boolean {
  if (message.role !== "assistant") return false;
  return Boolean(message.text?.trim() || message.thinking?.trim() || message.toolCalls?.length);
}

export function isTruncatedPrefix(imBody: string, acpText: string): boolean {
  const left = imBody.trim();
  const right = acpText.trim();
  if (!left || !right) return false;
  if (left === right) return false;
  return right.startsWith(left);
}

export function isSameAssistantTurn(imBody: string, acpText: string): boolean {
  const left = imBody.trim();
  const right = acpText.trim();
  return Boolean(left) && left === right;
}

export function planAcpHistorySync(input: {
  acpMessages: AcpChatMessage[];
  imMessages: ImMessage[];
  member: AcpHistorySyncMember;
  skipStreamingMessageIds?: Iterable<string>;
}): AcpHistorySyncPlan[] {
  const skip = new Set([...input.skipStreamingMessageIds ?? []].filter(Boolean));
  const knownAcpIds = new Set(
    input.imMessages
      .map((message) => message.acpMessageId?.trim())
      .filter((id): id is string => Boolean(id))
  );
  const memberMessages = input.imMessages
    .filter((message) => message.kind === "role.say" && message.authorMemberId === input.member.memberId)
    .sort((a, b) => a.createdAtMs - b.createdAtMs);
  const lastMemberMessage = [...memberMessages].reverse().find((message) => !skip.has(message.messageId));

  const plans: AcpHistorySyncPlan[] = [];
  let patchedLast = false;
  for (const acp of input.acpMessages) {
    if (!isImportableAcpAssistant(acp)) continue;
    const acpMessageId = acp.id?.trim();
    if (!acpMessageId) continue;
    if (knownAcpIds.has(acpMessageId)) continue;

    const body = acp.text ?? "";
    const thinking = acp.thinking?.trim() || undefined;
    const toolCalls = toImToolCalls(acp.toolCalls);
    const createdAtMs = Number.isFinite(acp.timestamp) ? acp.timestamp : Date.now();

    if (
      !patchedLast &&
      lastMemberMessage &&
      !lastMemberMessage.acpMessageId &&
      (isTruncatedPrefix(lastMemberMessage.body, body) || isSameAssistantTurn(lastMemberMessage.body, body))
    ) {
      plans.push({
        type: "update",
        messageId: lastMemberMessage.messageId,
        acpMessageId,
        body,
        thinking: thinking ?? lastMemberMessage.thinking,
        toolCalls: toolCalls ?? lastMemberMessage.toolCalls
      });
      knownAcpIds.add(acpMessageId);
      patchedLast = true;
      continue;
    }

    plans.push({
      type: "insert",
      acpMessageId,
      body,
      thinking,
      toolCalls,
      createdAtMs
    });
    knownAcpIds.add(acpMessageId);
  }
  return plans;
}
