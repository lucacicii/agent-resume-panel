/** Labels for fixed digest section titles (zh by default). */
export interface DigestLabels {
  emptyPlaceholder: string;
  none: string;
  daily: {
    h1Prefix: string;
    overview: string;
    workItems: string;
    decisions: string;
    blockers: string;
    nextSteps: string;
    sessionIndex: string;
  };
  weekly: {
    h1Prefix: string;
    rangePrefix: string;
    themes: string;
    progress: string;
    crossProject: string;
    unfinished: string;
    nextWeek: string;
    sourceDailies: string;
  };
  monthly: {
    h1Prefix: string;
    rangePrefix: string;
    summary: string;
    projectShifts: string;
    decisions: string;
    patterns: string;
    openThreads: string;
    sourceDailies: string;
  };
}

function isChineseLanguage(outputLanguage: string): boolean {
  const l = (outputLanguage || "").toLowerCase();
  return (
    l.includes("zh") ||
    l.includes("chinese") ||
    l.includes("中文") ||
    l.includes("cn")
  );
}

export function digestLanguageLabels(outputLanguage: string): DigestLabels {
  if (!isChineseLanguage(outputLanguage)) {
    return {
      emptyPlaceholder: "No catalogued agent activity.",
      none: "None",
      daily: {
        h1Prefix: "Daily",
        overview: "Overview",
        workItems: "Work items",
        decisions: "Decisions & outcomes",
        blockers: "Blockers & risks",
        nextSteps: "Next steps",
        sessionIndex: "Session index"
      },
      weekly: {
        h1Prefix: "Weekly",
        rangePrefix: "Range",
        themes: "Themes this week",
        progress: "Key progress",
        crossProject: "Cross-project links",
        unfinished: "Unfinished / tech debt",
        nextWeek: "Focus next week",
        sourceDailies: "Source dailies"
      },
      monthly: {
        h1Prefix: "Monthly",
        rangePrefix: "Range",
        summary: "Month summary",
        projectShifts: "Project & stage shifts",
        decisions: "Important decisions",
        patterns: "Patterns & habits",
        openThreads: "Open threads / next month",
        sourceDailies: "Source dailies"
      }
    };
  }

  return {
    emptyPlaceholder: "当日/本期无 catalog 中的 agent 活动。",
    none: "无",
    daily: {
      h1Prefix: "Daily",
      overview: "概览",
      workItems: "工作项",
      decisions: "决策与结论",
      blockers: "阻塞与风险",
      nextSteps: "下一步",
      sessionIndex: "Session 索引"
    },
    weekly: {
      h1Prefix: "Weekly",
      rangePrefix: "范围",
      themes: "本周主题",
      progress: "关键进展",
      crossProject: "跨项目关联",
      unfinished: "未完成 / 技术债",
      nextWeek: "下周焦点",
      sourceDailies: "来源日报"
    },
    monthly: {
      h1Prefix: "Monthly",
      rangePrefix: "范围",
      summary: "月度摘要",
      projectShifts: "项目与阶段变化",
      decisions: "重要决策",
      patterns: "模式与习惯",
      openThreads: "开放问题 / 下月线索",
      sourceDailies: "来源日报"
    }
  };
}

const SHARED_RULES = [
  "You are a personal work-memory analyst for a software engineer who uses multiple AI coding agents.",
  "Ground every claim in the provided inputs only. Do not invent work, projects, or outcomes.",
  "Output MUST follow OUTPUT_TEMPLATE exactly: keep every section heading verbatim; do not rename, reorder, or omit headings.",
  "Do NOT wrap the whole output in markdown code fences.",
  "Do NOT add any preamble or epilogue outside the template (no 'Here is the digest', no closing remarks).",
  "If a section has no content, keep the heading and write the empty placeholder shown in the template.",
  "Prefer concise bullets; keep each bullet self-contained."
].join(" ");

function dailyOutputTemplate(dateLabel: string, labels: DigestLabels): string {
  const L = labels.daily;
  const n = labels.none;
  return [
    `# ${L.h1Prefix} · ${dateLabel}`,
    "",
    `## ${L.overview}`,
    "{1-3 sentences}",
    "",
    `## ${L.workItems}`,
    "### {project or theme}",
    "- {bullet}",
    "",
    `## ${L.decisions}`,
    `- {bullet or ${n}}`,
    "",
    `## ${L.blockers}`,
    `- {bullet or ${n}}`,
    "",
    `## ${L.nextSteps}`,
    `- {bullet or ${n}}`,
    "",
    `## ${L.sessionIndex}`,
    "- [{provider}] {title}"
  ].join("\n");
}

function weeklyOutputTemplate(weekLabel: string, rangeHint: string, labels: DigestLabels): string {
  const L = labels.weekly;
  const n = labels.none;
  return [
    `# ${L.h1Prefix} · ${weekLabel}`,
    `> ${L.rangePrefix}: ${rangeHint}`,
    "",
    `## ${L.themes}`,
    "- {bullet}",
    "",
    `## ${L.progress}`,
    "### {theme or project}",
    "- {bullet}",
    "",
    `## ${L.crossProject}`,
    `- {bullet or ${n}}`,
    "",
    `## ${L.unfinished}`,
    `- {bullet or ${n}}`,
    "",
    `## ${L.nextWeek}`,
    `- {bullet or ${n}}`,
    "",
    `## ${L.sourceDailies}`,
    "- {daily title or id}"
  ].join("\n");
}

function monthlyOutputTemplate(monthLabel: string, rangeHint: string, labels: DigestLabels): string {
  const L = labels.monthly;
  const n = labels.none;
  return [
    `# ${L.h1Prefix} · ${monthLabel}`,
    `> ${L.rangePrefix}: ${rangeHint}`,
    "",
    `## ${L.summary}`,
    "{2-4 sentences}",
    "",
    `## ${L.projectShifts}`,
    "### {project}",
    "- {bullet}",
    "",
    `## ${L.decisions}`,
    `- {bullet or ${n}}`,
    "",
    `## ${L.patterns}`,
    `- {bullet or ${n}}`,
    "",
    `## ${L.openThreads}`,
    `- {bullet or ${n}}`,
    "",
    `## ${L.sourceDailies}`,
    "- {daily title or id}"
  ].join("\n");
}

export function buildDailySystemPrompt(outputLanguage: string): string {
  const labels = digestLanguageLabels(outputLanguage);
  return [
    SHARED_RULES,
    "Task: produce a DAILY digest from session summaries for one calendar day.",
    "Use session Summary fields as primary evidence.",
    `Write all body text in language: ${outputLanguage}.`,
    "Section headings in OUTPUT_TEMPLATE must stay exactly as given (including Chinese/English labels)."
  ].join(" ");
}

export function buildDailyUserPrompt(
  dateLabel: string,
  sessionLines: string[],
  outputLanguage = "zh-CN"
): string {
  const labels = digestLanguageLabels(outputLanguage);
  const template = dailyOutputTemplate(dateLabel, labels);
  if (!sessionLines.length) {
    return [
      `Date: ${dateLabel}`,
      "",
      "INPUT: No sessions were updated this day.",
      "",
      "OUTPUT_TEMPLATE (fill completely; overview must state no activity):",
      template,
      "",
      "Replace placeholders. Keep every heading. Output only the filled template."
    ].join("\n");
  }

  return [
    `Date: ${dateLabel}`,
    "",
    "INPUT sessions (most recent first):",
    ...sessionLines.map((line, i) => `${line}`.replace(/^/, `<!-- session ${i + 1} -->\n`)),
    "",
    "OUTPUT_TEMPLATE:",
    template,
    "",
    "Strictly follow OUTPUT_TEMPLATE. Do not omit any section heading. Output only the filled template."
  ].join("\n");
}

export function formatSessionForDigest(input: {
  provider: string;
  title: string;
  projectPath: string;
  summary?: string;
  transcriptSnippet?: string;
  updatedAt: number;
}): string {
  const when = new Date(input.updatedAt).toISOString();
  const summary = input.summary?.trim() || "(none)";
  const lines = [
    "### Session",
    `- provider: ${input.provider}`,
    `- title: ${input.title}`,
    `- project: ${input.projectPath}`,
    `- updatedAt: ${when}`,
    `- summary: |`,
    ...indentBlock(summary, 4).split("\n")
  ];
  const snippet = input.transcriptSnippet?.trim();
  if (snippet) {
    lines.push(`- transcriptExcerpt: |`);
    lines.push(...indentBlock(snippet, 4).split("\n"));
  }
  return lines.join("\n");
}

function indentBlock(text: string, spaces: number): string {
  const pad = " ".repeat(spaces);
  return text
    .split("\n")
    .map((line) => `${pad}${line}`)
    .join("\n");
}

export function buildWeeklySystemPrompt(outputLanguage: string): string {
  return [
    SHARED_RULES,
    "Task: produce a WEEKLY review from daily digests of one ISO week.",
    "Cluster by theme or project. Prefer higher-level synthesis over day-by-day copy.",
    `Write all body text in language: ${outputLanguage}.`,
    "Section headings in OUTPUT_TEMPLATE must stay exactly as given."
  ].join(" ");
}

export function buildWeeklyUserPrompt(
  weekLabel: string,
  rangeHint: string,
  lines: string[],
  outputLanguage = "zh-CN"
): string {
  const labels = digestLanguageLabels(outputLanguage);
  const template = weeklyOutputTemplate(weekLabel, rangeHint, labels);
  if (!lines.length) {
    return [
      `Week: ${weekLabel}`,
      `Range: ${rangeHint}`,
      "",
      "INPUT: No daily digests for this week.",
      "",
      "OUTPUT_TEMPLATE (fill completely; themes must state no activity):",
      template,
      "",
      "Replace placeholders. Keep every heading. Output only the filled template."
    ].join("\n");
  }
  return [
    `Week: ${weekLabel}`,
    `Range: ${rangeHint}`,
    "",
    "INPUT sources (daily digests):",
    ...lines.map((line, i) => `### Source ${i + 1}\n${line}`),
    "",
    "OUTPUT_TEMPLATE:",
    template,
    "",
    "Strictly follow OUTPUT_TEMPLATE. Do not omit any section heading. Output only the filled template."
  ].join("\n");
}

export function buildMonthlySystemPrompt(outputLanguage: string): string {
  return [
    SHARED_RULES,
    "Task: produce a MONTHLY archive from daily digests of one calendar month only (not multi-month weeks).",
    "Be selective; emphasize durable knowledge over day-to-day noise.",
    `Write all body text in language: ${outputLanguage}.`,
    "Section headings in OUTPUT_TEMPLATE must stay exactly as given."
  ].join(" ");
}

export function buildMonthlyUserPrompt(
  monthLabel: string,
  rangeHint: string,
  lines: string[],
  outputLanguage = "zh-CN"
): string {
  const labels = digestLanguageLabels(outputLanguage);
  const template = monthlyOutputTemplate(monthLabel, rangeHint, labels);
  if (!lines.length) {
    return [
      `Month: ${monthLabel}`,
      `Range: ${rangeHint}`,
      "",
      "INPUT: No daily digests for this month.",
      "",
      "OUTPUT_TEMPLATE (fill completely; summary must state no activity):",
      template,
      "",
      "Replace placeholders. Keep every heading. Output only the filled template."
    ].join("\n");
  }
  return [
    `Month: ${monthLabel}`,
    `Range: ${rangeHint}`,
    "",
    "INPUT sources (daily digests of this month only):",
    ...lines.map((line, i) => `### Source ${i + 1}\n${line}`),
    "",
    "OUTPUT_TEMPLATE:",
    template,
    "",
    "Strictly follow OUTPUT_TEMPLATE. Do not omit any section heading. Output only the filled template."
  ].join("\n");
}

/**
 * Light cleanup of model output: strip wrapping fences and outer whitespace.
 */
export function normalizeDigestMarkdown(raw: string): string {
  let text = (raw || "").trim();
  // Full-document fence
  const fullFence = text.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/i);
  if (fullFence) {
    text = fullFence[1].trim();
  } else {
    // Leading fence without strict end
    text = text.replace(/^```(?:markdown|md)?\s*\n/i, "");
    text = text.replace(/\n```\s*$/i, "");
    text = text.trim();
  }
  // Drop common preambles on first line
  text = text.replace(/^(here is|以下是|如下是)[^\n]*\n+/i, "");
  return text.trim();
}
