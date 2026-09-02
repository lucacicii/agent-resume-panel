import {
  chatCompletionDetailed,
  chatLlmConfigFromSettings,
  recordLlmUsage,
  type PanelSettings
} from "@agent-resume/core";
import type { ImMember, IntentRouteResult } from "../../shared/imTypes";

export const INTENT_ROUTING_TIMEOUT_MS = 30_000;

const FAST_UNMATCHED_REGEX = /^(好的|收到|ok|yes|no|hi|hello|你好|谢谢|thanks|thx|嗯|对|是的|明白|了解|再见|bye)[\s!.,，。！~]*$/i;

/** Bilingual responsibility keywords per builtin role, so routing never depends on persona wording alone. */
const BUILTIN_ROLE_ROUTING_HINTS: Readonly<Record<string, string>> = {
  role_product_manager: "requirements, PRD, user stories, acceptance criteria, 需求",
  role_architect: "architecture, system design, module boundaries, technical plan, 架构, 技术方案",
  role_project_manager: "task breakdown, milestones, risks, ownership, 任务拆解, 排期, 风险",
  role_ui_designer: "UI, UX, interaction, visual design, copy, 界面, 设计, 文案",
  role_developer: "write or change code, implement features, fix bugs, run commands, 写代码, 改代码, 实现功能, 修 bug",
  role_tester: "test cases, QA, reproduction, defects, 测试, 用例, 缺陷",
  role_memory:
    "notes, 笔记, note-taking, knowledge base, 知识库, memory, digests, daily/weekly/monthly reports, 日报/周报/月报, past sessions, session history, 历史会话"
};

/** Role list for the routing LLM: generous persona excerpt plus builtin responsibility hints. */
export function buildRolesRoutingPrompt(members: ImMember[]): string {
  return members
    .map((m) => {
      const hint = BUILTIN_ROLE_ROUTING_HINTS[m.templateId];
      const responsibility = hint
        ? `${m.persona.slice(0, 400)} Responsibilities include: ${hint}.`
        : m.persona.slice(0, 400);
      return `- ${m.name} (id: ${m.templateId}): ${responsibility}`;
    })
    .join("\n");
}

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
      found = enabledMembers.find((m) => {
        const name = m.name.toLowerCase();
        const templateId = m.templateId.toLowerCase();
        const shortTemplateId = templateId.replace(/^role_/, "");
        if (
          name === lowerName ||
          name === lowerId ||
          templateId === lowerName ||
          templateId === lowerId ||
          shortTemplateId === lowerId ||
          shortTemplateId === lowerName
        ) {
          return true;
        }
        // Every word of the member name appears in the returned target name
        // (e.g. targetName "Memory & Knowledge Specialist" → member "Memory Specialist").
        if (lowerName.length >= 4) {
          const nameWords = name.split(/[^a-z0-9]+/).filter((word) => word.length > 2);
          if (nameWords.length > 0 && nameWords.every((word) => lowerName.includes(word))) {
            return true;
          }
        }
        return (
          (lowerId.includes("dev") && m.templateId === "role_developer") ||
          (lowerId.includes("arch") && m.templateId === "role_architect") ||
          (lowerId.includes("product") && m.templateId === "role_product_manager") ||
          (lowerId.includes("project") && m.templateId === "role_project_manager") ||
          (lowerId.includes("test") && m.templateId === "role_tester") ||
          (lowerId.includes("ui") && m.templateId === "role_ui_designer") ||
          ((lowerId.includes("mem") || lowerId.includes("know") || lowerId.includes("note")) &&
            m.templateId === "role_memory")
        );
      });
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

  const rolesPrompt = buildRolesRoutingPrompt(enabledMembers);

  const prompt = `You are an intelligent intent router in a multi-role software project IM chat.
Your job is to analyze the user's message and determine if it requires action from one of the active roles in the room.

[Available Room Roles]
${rolesPrompt}

[User Message]
${trimmed}

[Instructions]
1. If the user message is a concrete question, instruction, task request, feature requirement, architecture query, design request, or bug report that clearly fits ONE of the available roles above, match that role.
2. Route by responsibility, not by who could theoretically help. Questions about notes, note-taking, knowledge base, memory, digests, daily/weekly/monthly reports, or past sessions/history belong to the Memory/Knowledge role when present — do NOT route them to Developer unless the user explicitly asks to write or change code.
3. If the user message is general chatting, informational statement, greeting, acknowledgement, ambiguous discussion, or does not clearly fit any role's responsibility, set "matched": false.
4. Return ONLY valid JSON in this exact structure without markdown or explanation:
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
