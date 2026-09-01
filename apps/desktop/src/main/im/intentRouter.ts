import {
  chatCompletionDetailed,
  chatLlmConfigFromSettings,
  recordLlmUsage,
  type PanelSettings
} from "@agent-resume/core";
import type { ImMember, IntentRouteResult } from "../../shared/imTypes";

export const INTENT_ROUTING_TIMEOUT_MS = 30_000;

const FAST_UNMATCHED_REGEX = /^(好的|收到|ok|yes|no|hi|hello|你好|谢谢|thanks|thx|嗯|对|是的|明白|了解|再见|bye)[\s!.,，。！~]*$/i;

function cleanJson(text: string): string {
  const match = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  return match ? match[1]!.trim() : text.trim();
}

export function parseIntentClassification(
  rawText: string,
  enabledMembers: ImMember[]
): { matched: boolean; targetMember?: ImMember; reason?: string } {
  try {
    const jsonStr = cleanJson(rawText);
    const parsed = JSON.parse(jsonStr) as {
      matched?: boolean;
      targetId?: string;
      targetName?: string;
      reason?: string;
    };
    if (!parsed.matched) {
      return { matched: false, reason: parsed.reason };
    }
    const targetId = parsed.targetId?.trim() || "";
    const targetName = parsed.targetName?.trim() || "";
    const lowerId = targetId.toLowerCase();
    const lowerName = targetName.toLowerCase();

    // 1. Exact templateId or memberId
    let found = enabledMembers.find((m) => m.templateId === targetId || m.memberId === targetId);

    // 2. Name or alias match
    if (!found) {
      found = enabledMembers.find(
        (m) =>
          m.name.toLowerCase() === lowerName ||
          m.name.toLowerCase() === lowerId ||
          m.templateId.toLowerCase() === lowerName ||
          m.templateId.toLowerCase() === lowerId ||
          m.templateId.replace(/^role_/, "").toLowerCase() === lowerId ||
          m.templateId.replace(/^role_/, "").toLowerCase() === lowerName ||
          (lowerId.includes("dev") && m.templateId === "role_developer") ||
          (lowerId.includes("arch") && m.templateId === "role_architect") ||
          (lowerId.includes("product") && m.templateId === "role_product_manager") ||
          (lowerId.includes("project") && m.templateId === "role_project_manager") ||
          (lowerId.includes("test") && m.templateId === "role_tester") ||
          (lowerId.includes("ui") && m.templateId === "role_ui_designer") ||
          (lowerId.includes("mem") && m.templateId === "role_memory") ||
          (lowerId.includes("know") && m.templateId === "role_memory") ||
          (lowerId.includes("note") && m.templateId === "role_memory")
      );
    }
    if (found) {
      return { matched: true, targetMember: found, reason: parsed.reason };
    }
    return { matched: false, reason: parsed.reason };
  } catch {
    return { matched: false };
  }
}

export async function routeMessageIntent(options: {
  text: string;
  roomMembers: ImMember[];
  settings: PanelSettings;
  desktopDb: string;
  timeoutMs?: number;
}): Promise<IntentRouteResult> {
  const { text, roomMembers, settings, desktopDb } = options;
  const timeoutMs = options.timeoutMs ?? INTENT_ROUTING_TIMEOUT_MS;
  const trimmed = text.trim();

  // Fast path heuristics
  if (!trimmed || trimmed.length <= 4 || FAST_UNMATCHED_REGEX.test(trimmed)) {
    return {
      matched: false,
      timedOut: false,
      tip: "desktop.im.routingUnmatchedTip"
    };
  }

  const enabledMembers = roomMembers.filter((m) => m.enabled);
  if (!enabledMembers.length) {
    return {
      matched: false,
      timedOut: false,
      tip: "desktop.im.routingUnmatchedTip"
    };
  }

  const llm = chatLlmConfigFromSettings(settings);
  if (!llm) {
    return {
      matched: false,
      timedOut: false,
      tip: "desktop.im.routingUnmatchedTip"
    };
  }

  const rolesPrompt = enabledMembers
    .map((m) => `- ${m.name} (id: ${m.templateId}): ${m.persona.slice(0, 150)}`)
    .join("\n");

  const prompt = `You are an intelligent intent router in a multi-role software project IM chat.
Your job is to analyze the user's message and determine if it requires action from one of the active roles in the room.

[Available Room Roles]
${rolesPrompt}

[User Message]
${trimmed}

[Instructions]
1. If the user message is a concrete question, instruction, task request, feature requirement, architecture query, design request, or bug report that clearly fits ONE of the available roles above, match that role.
2. If the user message is general chatting, informational statement, greeting, acknowledgement, ambiguous discussion, or does not clearly fit any role's responsibility, set "matched": false.
3. Return ONLY valid JSON in this exact structure without markdown or explanation:
{
  "matched": true,
  "targetId": "<role_template_id>",
  "targetName": "<Role Name>",
  "reason": "<Brief explanation in 1 sentence>"
}
or:
{
  "matched": false,
  "reason": "General discussion without actionable task"
}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const result = await chatCompletionDetailed(
      llm,
      [{ role: "user", content: prompt }],
      512,
      controller.signal
    );
    clearTimeout(timer);

    await recordLlmUsage(desktopDb, {
      kind: "chat",
      source: "im_intent_router",
      jobKey: "intent_route",
      model: result.model,
      usage: result.usage,
      durationMs: result.durationMs,
      ok: true
    }).catch(() => undefined);

    const classification = parseIntentClassification(result.content, enabledMembers);
    if (classification.matched && classification.targetMember) {
      return {
        matched: true,
        targetMemberId: classification.targetMember.memberId,
        targetTemplateId: classification.targetMember.templateId,
        targetRoleName: classification.targetMember.name,
        reason: classification.reason,
        timedOut: false
      };
    }
    return {
      matched: false,
      timedOut: false,
      tip: "desktop.im.routingUnmatchedTip"
    };
  } catch (error: any) {
    clearTimeout(timer);
    const isAborted =
      Boolean(controller.signal.aborted) ||
      error?.name === "AbortError" ||
      error?.name === "TimeoutError" ||
      /abort|timed?\s*out/i.test(String(error?.message || ""));
    await recordLlmUsage(desktopDb, {
      kind: "chat",
      source: "im_intent_router",
      jobKey: "intent_route",
      model: llm.model,
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    }).catch(() => undefined);

    if (isAborted) {
      return {
        matched: false,
        timedOut: true,
        tip: "desktop.im.routingTimeoutTip"
      };
    }
    return {
      matched: false,
      timedOut: false,
      tip: "desktop.im.routingUnmatchedTip"
    };
  }
}
