import * as vscode from "vscode";

export type SectionKind = "recentRoot" | "favoritesRoot" | "projectsRoot";

const STORAGE_KEY = "agentResume.sectionOrder";

export const ALL_SECTIONS: SectionKind[] = ["recentRoot", "favoritesRoot", "projectsRoot"];

export const DEFAULT_SECTION_ORDER: SectionKind[] = [...ALL_SECTIONS];

export function loadSectionOrder(context: vscode.ExtensionContext): SectionKind[] {
  const stored = context.globalState.get<string[]>(STORAGE_KEY, DEFAULT_SECTION_ORDER);
  return normalizeSectionOrder(stored);
}

export async function saveSectionOrder(
  context: vscode.ExtensionContext,
  order: SectionKind[]
): Promise<void> {
  await context.globalState.update(STORAGE_KEY, normalizeSectionOrder(order));
}

export function moveSection(order: SectionKind[], source: SectionKind, target: SectionKind): SectionKind[] {
  if (source === target) {
    return order;
  }

  const normalized = normalizeSectionOrder(order);
  const withoutSource = normalized.filter((kind) => kind !== source);
  const targetIndex = withoutSource.indexOf(target);
  if (targetIndex === -1) {
    return normalized;
  }

  withoutSource.splice(targetIndex, 0, source);
  return withoutSource;
}

function normalizeSectionOrder(order: string[]): SectionKind[] {
  const seen = new Set<SectionKind>();
  const output: SectionKind[] = [];

  for (const entry of order) {
    if (!isSectionKind(entry) || seen.has(entry)) {
      continue;
    }
    seen.add(entry);
    output.push(entry);
  }

  for (const kind of ALL_SECTIONS) {
    if (!seen.has(kind)) {
      output.push(kind);
    }
  }

  return output.length === ALL_SECTIONS.length ? output : [...DEFAULT_SECTION_ORDER];
}

function isSectionKind(value: string): value is SectionKind {
  return value === "recentRoot" || value === "favoritesRoot" || value === "projectsRoot";
}