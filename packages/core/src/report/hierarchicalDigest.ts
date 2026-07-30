import { chatCompletionDetailed } from "../llm/chat";
import type { LlmRuntimeConfig } from "../llm/types";
import { recordLlmUsage } from "../usage/store";
import type { DigestProgressCallback, DigestLevel } from "./progress";

const DEFAULT_CONTEXT_CHARS = 120_000;
const MIN_SOURCE_BUDGET = 2_000;
const MAX_REDUCE_ROUNDS = 8;

export interface HierarchicalDigestOptions {
  llm: LlmRuntimeConfig;
  desktopDb: string;
  source: "daily" | "weekly" | "monthly";
  jobKey: string;
  level: DigestLevel;
  periodLabel: string;
  outputLanguage: string;
  sourceItems: string[];
  finalSystemPrompt: string;
  buildFinalUserPrompt: (items: string[]) => string;
  maxTokens: number;
  onProgress?: DigestProgressCallback;
  progressMessage?: (current: number, total: number) => string;
  reduceMessage?: (round: number) => string;
}

export interface HierarchicalDigestResult {
  content: string;
  chunkCount: number;
}

function contextLimit(config: LlmRuntimeConfig): number {
  const configured = Number(config.maxContextChars);
  return Number.isFinite(configured) && configured > 0
    ? Math.max(4_000, Math.floor(configured))
    : DEFAULT_CONTEXT_CHARS;
}

function requestFits(system: string, user: string, limit: number): boolean {
  // Leave room for message framing and the model response.
  return system.length + user.length <= Math.floor(limit * 0.78);
}

function sourceBudget(limit: number): number {
  return Math.max(MIN_SOURCE_BUDGET, Math.floor(limit * 0.55));
}

function splitOversizedSource(raw: string, budget: number): string[] {
  if (raw.length <= budget) return [raw];
  const parts: string[] = [];
  let remaining = raw;
  while (remaining.length > budget) {
    let splitAt = remaining.lastIndexOf("\n\n", budget);
    if (splitAt < Math.floor(budget * 0.4)) splitAt = remaining.lastIndexOf("\n", budget);
    if (splitAt < Math.floor(budget * 0.4)) splitAt = budget;
    parts.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).replace(/^\s+/, "");
  }
  if (remaining) parts.push(remaining);
  return parts.map((part, index) => parts.length > 1
    ? `[source continuation ${index + 1}/${parts.length}]\n${part}`
    : part);
}

function packItems(items: string[], budget: number): string[][] {
  const groups: string[][] = [];
  let current: string[] = [];
  let length = 0;
  for (const item of items.flatMap((raw) => splitOversizedSource(raw, budget))) {
    const added = item.length + (current.length ? 2 : 0);
    if (current.length && length + added > budget) {
      groups.push(current);
      current = [];
      length = 0;
    }
    current.push(item);
    length += item.length + (current.length > 1 ? 2 : 0);
  }
  if (current.length) groups.push(current);
  return groups;
}

function contextLengthError(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return message.includes("context length")
    || message.includes("maximum context")
    || message.includes("too many tokens")
    || message.includes("context_window");
}

function intermediateSystemPrompt(language: string): string {
  return [
    "You compress source material for a work-memory digest.",
    "Preserve concrete projects, outcomes, decisions, blockers, unfinished work, explicit next actions, and source identifiers.",
    "Do not invent facts or mark work complete unless the source explicitly says so.",
    "Return concise Markdown bullets without a preamble.",
    `Write in language: ${language}.`
  ].join(" ");
}

function intermediateUserPrompt(level: DigestLevel, periodLabel: string, items: string[]): string {
  return [
    `Target digest: ${level} · ${periodLabel}`,
    "",
    "SOURCE BATCH:",
    ...items.map((item, index) => `### Source ${index + 1}
${item}`),
    "",
    "Compress this batch while retaining all material facts needed by the final digest."
  ].join("\n");
}

export async function runHierarchicalDigest(
  options: HierarchicalDigestOptions
): Promise<HierarchicalDigestResult> {
  const limit = contextLimit(options.llm);
  const initialUser = options.buildFinalUserPrompt(options.sourceItems);
  let callIndex = 0;

  const call = async (
    system: string,
    user: string,
    maxTokens: number,
    stage: string
  ): Promise<string> => {
    callIndex += 1;
    try {
      const result = await chatCompletionDetailed(
        options.llm,
        [
          { role: "system", content: system },
          { role: "user", content: user }
        ],
        maxTokens
      );
      await recordLlmUsage(options.desktopDb, {
        kind: "chat",
        source: options.source,
        jobKey: `${options.jobKey}:${stage}:${callIndex}`,
        model: result.model,
        usage: result.usage,
        durationMs: result.durationMs,
        ok: true
      });
      return result.content;
    } catch (error) {
      await recordLlmUsage(options.desktopDb, {
        kind: "chat",
        source: options.source,
        jobKey: `${options.jobKey}:${stage}:${callIndex}`,
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      }).catch(() => undefined);
      throw error;
    }
  };

  if (requestFits(options.finalSystemPrompt, initialUser, limit)) {
    try {
      return {
        content: await call(options.finalSystemPrompt, initialUser, options.maxTokens, "final"),
        chunkCount: 1
      };
    } catch (error) {
      if (!contextLengthError(error)) throw error;
      // The endpoint may expose a smaller context than configured; fall through to splitting.
    }
  }

  const budget = sourceBudget(limit);
  const initialGroups = packItems(options.sourceItems, budget);
  const chunkCount = initialGroups.length;
  const compress = async (items: string[], stage: string): Promise<string> => {
    const system = intermediateSystemPrompt(options.outputLanguage);
    const user = intermediateUserPrompt(options.level, options.periodLabel, items);
    try {
      return await call(system, user, Math.min(options.maxTokens, 1800), stage);
    } catch (error) {
      if (!contextLengthError(error)) throw error;
      if (items.length > 1) {
        const middle = Math.ceil(items.length / 2);
        const left = await compress(items.slice(0, middle), `${stage}a`);
        const right = await compress(items.slice(middle), `${stage}b`);
        return compress([left, right], `${stage}r`);
      }
      const split = splitOversizedSource(items[0], Math.max(1_000, Math.floor(items[0].length / 2)));
      if (split.length <= 1) throw error;
      const left = await compress([split[0]], `${stage}a`);
      const right = await compress(split.slice(1), `${stage}b`);
      return compress([left, right], `${stage}r`);
    }
  };

  let summaries: string[] = [];
  for (let i = 0; i < initialGroups.length; i += 1) {
    options.onProgress?.({
      phase: "chunk",
      level: options.level,
      periodLabel: options.periodLabel,
      message: options.progressMessage?.(i + 1, initialGroups.length),
      index: i + 1,
      total: initialGroups.length
    });
    summaries.push(await compress(initialGroups[i], `chunk${i + 1}`));
  }

  let round = 0;
  while (!requestFits(options.finalSystemPrompt, options.buildFinalUserPrompt(summaries), limit)) {
    round += 1;
    if (round > MAX_REDUCE_ROUNDS) {
      throw new Error("Digest sources remain larger than the configured model context after hierarchical reduction.");
    }
    options.onProgress?.({
      phase: "reduce",
      level: options.level,
      periodLabel: options.periodLabel,
      message: options.reduceMessage?.(round),
      index: round
    });
    const groups = packItems(summaries, budget);
    const reduced: string[] = [];
    for (let i = 0; i < groups.length; i += 1) {
      reduced.push(await compress(groups[i], `reduce${round}-${i + 1}`));
    }
    if (reduced.length >= summaries.length && summaries.length > 1) {
      // Force progress when summaries individually consume most of the budget.
      const middle = Math.ceil(summaries.length / 2);
      summaries = [
        await compress(summaries.slice(0, middle), `reduce${round}a`),
        await compress(summaries.slice(middle), `reduce${round}b`)
      ].filter(Boolean);
    } else {
      summaries = reduced;
    }
  }

  let finalItems = summaries;
  for (let attempt = 0; attempt <= MAX_REDUCE_ROUNDS; attempt += 1) {
    const finalUser = options.buildFinalUserPrompt(finalItems);
    try {
      return {
        content: await call(options.finalSystemPrompt, finalUser, options.maxTokens, "final"),
        chunkCount
      };
    } catch (error) {
      if (!contextLengthError(error) || attempt === MAX_REDUCE_ROUNDS) throw error;
      options.onProgress?.({
        phase: "reduce",
        level: options.level,
        periodLabel: options.periodLabel,
        message: options.reduceMessage?.(round + attempt + 1),
        index: round + attempt + 1
      });
      if (finalItems.length > 1) {
        const middle = Math.ceil(finalItems.length / 2);
        finalItems = [
          await compress(finalItems.slice(0, middle), `final-reduce${attempt + 1}a`),
          await compress(finalItems.slice(middle), `final-reduce${attempt + 1}b`)
        ].filter(Boolean);
      } else {
        const only = finalItems[0] || "";
        const split = splitOversizedSource(only, Math.max(1_000, Math.floor(only.length / 2)));
        if (split.length <= 1) throw error;
        finalItems = [
          await compress([split[0]], `final-split${attempt + 1}a`),
          await compress(split.slice(1), `final-split${attempt + 1}b`)
        ];
      }
    }
  }
  throw new Error("Could not fit digest sources into the configured model context.");
}
