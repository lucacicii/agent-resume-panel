export type CommitMessageStyle = "conventional" | "gitmoji" | "custom";

export const COMMIT_INSTRUCTION_MAX_CHARS = 4000;

export interface CommitMessagePromptOptions {
  style?: CommitMessageStyle;
  customInstructions?: string;
  /** Project-level rules appended after the selected style. */
  extraInstructions?: string;
}

export const DEFAULT_CONVENTIONAL_COMMIT_INSTRUCTIONS = [
  "Use Conventional Commits format: type(scope): description, or type: description when no reliable scope is available.",
  "Use exactly one of these types: feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert.",
  "Use the optional scope only when it can be reliably inferred from the changes."
].join(" ");

const GITMOJI_COMMIT_INSTRUCTIONS = [
  "Use Gitmoji with Conventional Commits format: emoji type(scope): description, or emoji type: description when no reliable scope is available.",
  "Start the subject with one appropriate real Gitmoji emoji followed by a space; never use :shortcode: notation.",
  "Use exactly one of these types: feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert.",
  "Use the optional scope only when it can be reliably inferred from the changes."
].join(" ");

const CONVENTIONAL_TYPES = [
  "feat",
  "fix",
  "docs",
  "style",
  "refactor",
  "perf",
  "test",
  "build",
  "ci",
  "chore",
  "revert"
] as const;

const CONVENTIONAL_SUBJECT_PATTERN = new RegExp(
  `^(${CONVENTIONAL_TYPES.join("|")})(?:\\([^)]+\\))?!?:\\s+(.+)$`,
  "i"
);
const LEADING_GITMOJI_PATTERN = /^(\p{Extended_Pictographic}\uFE0F?)\s+(.+)$/u;

const GITMOJI_BY_TYPE: Record<(typeof CONVENTIONAL_TYPES)[number], string> = {
  feat: "✨",
  fix: "🐛",
  docs: "📝",
  style: "🎨",
  refactor: "♻️",
  perf: "⚡️",
  test: "✅",
  build: "👷",
  ci: "👷",
  chore: "🔧",
  revert: "⏪"
};

export function normalizeCommitMessageStyle(value: unknown): CommitMessageStyle {
  return value === "gitmoji" || value === "custom" ? value : "conventional";
}

export function normalizeCustomCommitInstructions(value: unknown): string {
  const instructions = typeof value === "string" ? value.trim() : "";
  return instructions ? instructions.slice(0, COMMIT_INSTRUCTION_MAX_CHARS) : DEFAULT_CONVENTIONAL_COMMIT_INSTRUCTIONS;
}

export function normalizeExtraCommitInstructions(value: unknown): string {
  const instructions = typeof value === "string" ? value.trim() : "";
  return instructions ? instructions.slice(0, COMMIT_INSTRUCTION_MAX_CHARS) : "";
}

function inferConventionalType(subject: string): { type: (typeof CONVENTIONAL_TYPES)[number]; description: string } {
  const rules: Array<[(typeof CONVENTIONAL_TYPES)[number], RegExp]> = [
    ["fix", /^(?:fix(?:es|ed)?|bugfix|修复|修正|解决|处理)\s*[:：-]?\s*/i],
    ["feat", /^(?:feat|add(?:s|ed)?|implement(?:s|ed)?|support(?:s|ed)?|introduce(?:s|d)?|新增|添加|实现|支持)\s*[:：-]?\s*/i],
    ["docs", /^(?:docs?|document(?:s|ed)?|文档)\s*[:：-]?\s*/i],
    ["style", /^(?:style|format(?:s|ted)?|样式|格式化)\s*[:：-]?\s*/i],
    ["refactor", /^(?:refactor(?:s|ed)?|重构)\s*[:：-]?\s*/i],
    ["perf", /^(?:perf(?:ormance)?|optimi[sz](?:e|es|ed|ation)|性能|优化)\s*[:：-]?\s*/i],
    ["test", /^(?:tests?|测试)\s*[:：-]?\s*/i],
    ["build", /^(?:build|package|构建|打包)\s*[:：-]?\s*/i],
    ["ci", /^(?:ci|pipeline|workflow|持续集成)\s*[:：-]?\s*/i],
    ["revert", /^(?:revert(?:s|ed)?|回滚)\s*[:：-]?\s*/i],
    ["chore", /^(?:chore|update(?:s|d)?|upgrade(?:s|d)?|maint(?:enance)?|更新|升级|维护|调整)\s*[:：-]?\s*/i]
  ];

  for (const [type, pattern] of rules) {
    if (pattern.test(subject)) {
      const description = subject.replace(pattern, "").trim();
      return { type, description: description || subject };
    }
  }
  return { type: "chore", description: subject };
}

function ensureConventionalSubject(subject: string): { type: (typeof CONVENTIONAL_TYPES)[number]; subject: string } {
  const match = subject.match(CONVENTIONAL_SUBJECT_PATTERN);
  if (match) {
    return { type: match[1].toLowerCase() as (typeof CONVENTIONAL_TYPES)[number], subject };
  }
  const { type, description } = inferConventionalType(subject);
  return { type, subject: `${type}: ${description}` };
}

function applyCommitMessageStyle(message: string, options?: CommitMessagePromptOptions): string {
  const style = normalizeCommitMessageStyle(options?.style);
  if (style === "custom") return message;

  const [subject, ...body] = message.split("\n");
  const emojiMatch = subject.match(LEADING_GITMOJI_PATTERN);
  const conventional = ensureConventionalSubject(emojiMatch ? emojiMatch[2] : subject);
  const styledSubject =
    style === "gitmoji"
      ? `${emojiMatch?.[1] || GITMOJI_BY_TYPE[conventional.type]} ${conventional.subject}`
      : conventional.subject;
  return [styledSubject, ...body].join("\n");
}

function formatInstructions(options?: CommitMessagePromptOptions): string {
  let base: string;
  switch (normalizeCommitMessageStyle(options?.style)) {
    case "gitmoji":
      base = GITMOJI_COMMIT_INSTRUCTIONS;
      break;
    case "custom":
      base = normalizeCustomCommitInstructions(options?.customInstructions);
      break;
    default:
      base = DEFAULT_CONVENTIONAL_COMMIT_INSTRUCTIONS;
  }
  const extra = normalizeExtraCommitInstructions(options?.extraInstructions);
  return extra ? `${base} ADDITIONAL PROJECT RULES: ${extra}` : base;
}

export function buildCommitMessageSystemPrompt(
  outputLanguage: string,
  options?: CommitMessagePromptOptions
): string {
  return [
    "You write concise Git commit messages for software developers.",
    "Your ONLY job: output one commit message based on the provided git status and diff.",
    "STRICT rules:",
    "- Output the commit message only — no quotes, no prefix (no \"Commit:\"), no explanation.",
    "- Use imperative mood in the subject line (e.g. \"Fix login redirect\").",
    "- Subject line should be at most 72 characters.",
    "- Optionally add a blank line and a short body for non-trivial changes.",
    "- Do NOT invent changes not shown in the diff or status.",
    `- Write the commit message in language: ${outputLanguage}.`,
    "Ignore the language used in file contents or diff context when choosing output language.",
    `FORMAT RULES: ${formatInstructions(options)}`
  ].join(" ");
}

export function buildCommitMessageUserPrompt(
  statusText: string,
  diffText: string,
  outputLanguage: string
): string {
  return `[TASK]
Write a Git commit message in ${outputLanguage} summarizing these changes.

[git status --porcelain]
${statusText || "(no status output)"}

[git diff]
${diffText || "(no diff output)"}

Reply with the commit message only:`;
}

/** Strip wrappers and keep a reasonable commit message from LLM output. */
export function normalizeSuggestedCommitMessage(raw: string, options?: CommitMessagePromptOptions): string {
  let message = raw.trim();
  message = message.replace(/^["'`]+|["'`]+$/g, "");
  message = message.replace(/^commit\s+message\s*[:：]\s*/i, "");
  if (message.length > 8000) {
    message = message.slice(0, 8000).trim();
  }
  return message ? applyCommitMessageStyle(message, options) : message;
}
