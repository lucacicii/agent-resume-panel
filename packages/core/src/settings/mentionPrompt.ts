import type { WorkbenchComposerMention } from "./types";

function mentionIdKey(id: string): string {
  return id.trim().replace(/^@+/, "").toLowerCase();
}

function cwdKey(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return trimmed.replace(/[\\/]+$/, "") || trimmed;
}

export function resolveMention(
  mentions: readonly WorkbenchComposerMention[] | undefined | null,
  id: string
): WorkbenchComposerMention | null {
  const needle = mentionIdKey(id);
  if (!needle) return null;
  return mentions?.find((item) => item.id.toLowerCase() === needle) ?? null;
}

export function matchMentionForCwd(
  mentions: readonly WorkbenchComposerMention[] | undefined | null,
  cwd: string
): WorkbenchComposerMention | null {
  const key = cwdKey(cwd);
  if (!key || !mentions?.length) return null;
  return mentions.find((item) => cwdKey(item.cwd) === key) ?? null;
}

export function buildMentionPrompt(mention: WorkbenchComposerMention): string {
  const references = mention.roots.filter((root) => root.role === "reference");
  const lines = [
    `[Workspace ${mention.id}]`,
    `Work cwd (write here only): ${mention.cwd}`
  ];
  if (references.length) {
    lines.push("Reference (read only):");
    for (const root of references) {
      lines.push(`- ${root.path}`);
    }
  }
  return lines.join("\n");
}
