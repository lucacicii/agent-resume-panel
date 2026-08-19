import { TagCategory } from "./types";

export const TAG_CATEGORY_DESCRIPTIONS: Record<TagCategory, string> = {
  tech_stack: "programming language / framework / library / toolchain / runtime",
  business_domain: "business domain / feature module / business process",
  architecture: "architecture / design pattern / protocol / system mechanism",
  task_type: "engineering task nature / R&D activity type",
  problem_domain: "bug / failure / error type / incident / pain point scenario",
  concept_knowledge: "algorithm / core concept / theory / standard / spec",
  context_env: "target platform / environment context / branch / release"
};

export const TAG_CATEGORY_EXAMPLES: Record<TagCategory, string> = {
  tech_stack: "React 19, TypeScript, Electron, SQLite, Tailwind CSS, Vite, xterm.js",
  business_domain: "auth & permissions, workbench sessions, data backup, GTD task management, i18n, code review",
  architecture: "IPC, state machine, RAG retrieval, event bus, virtualized list, DAG workflow",
  task_type: "bug fix, performance, refactor, new feature, unit test, dependency upgrade",
  problem_domain: "memory leak, race condition, 404, CORS, encoding mojibake, deadlock",
  concept_knowledge: "vector embeddings, cosine similarity, AST parsing, token optimization, git flow, OAuth 2.0",
  context_env: "macOS, Windows, Release v0.2, monorepo, CI/CD"
};

export function buildTagSystemPrompt(outputLanguage: string): string {
  const lang = outputLanguage?.toLowerCase()?.includes("zh") ? "Chinese" : "English";
  const dimensionLines = (
    Object.keys(TAG_CATEGORY_DESCRIPTIONS) as TagCategory[]
  )
    .map((cat) => `  - "${cat}": ${TAG_CATEGORY_DESCRIPTIONS[cat]} (e.g. ${TAG_CATEGORY_EXAMPLES[cat]})`)
    .join("\n");

  return `You extract concise, high-coverage semantic tags from coding-session and note content for a knowledge base.

Cover 7 broad dimensions as widely as possible. For each dimension you identify, emit ONE concise tag (2-4 words max). Use the tag's English key when possible but you may keep the original language term if it is more precise.

${dimensionLines}

Return ONLY a JSON object, no markdown, no commentary:
{
  "tags": [
    {"tag": "React 19", "category": "tech_stack", "confidence": 0.9},
    ...
  ]
}

Rules:
- 3 to 8 tags total, at most 1 tag per dimension.
- Prefer concrete, reusable names over overly generic words.
- confidence: 0.0-1.0 reflecting how confident the label really describes the content.
- Keep tags short; normalize case (capitalize the first letter of meaningful words).`;
}

export function buildSessionTagUserPrompt(
  title: string | undefined,
  summary: string | undefined,
  transcriptExcerpt: string,
  maxChars: number
): string {
  const clip = (s: string | undefined) => {
    if (!s) return "";
    return s.length > maxChars ? `${s.slice(0, maxChars)}…` : s;
  };
  const lines = [
    "# Session",
    title ? `Title: ${clip(title)}` : "Title: (untitled)",
    summary ? `Summary: ${clip(summary)}` : "",
    "Transcript excerpt:",
    clip(transcriptExcerpt) || "(no transcript)"
  ].filter((l) => l.length > 0);
  return lines.join("\n");
}

export function buildNoteTagUserPrompt(
  title: string,
  body: string,
  maxChars: number
): string {
  const clip = (s: string) => {
    if (!s) return "";
    return s.length > maxChars ? `${s.slice(0, maxChars)}…` : s;
  };
  return `# Note\nTitle: ${clip(title)}\n\nBody:\n${clip(body) || "(empty)"}`;
}