import {
  fuzzyMatchPath,
  normalizeQuickAccessQuery,
  type FuzzyPathMatch
} from "../../../../shared/quickAccessPathMatch";

/**
 * One selectable local folder in the Search side panel's root picker.
 *
 * The picker lists the active task's referenced folders, or the catalog
 * projects when no task is open — both are plain local roots, so the option
 * only needs what the picker and the search scope display.
 */
export interface SearchRootOption {
  id: string;
  path: string;
  label: string;
  detail: string;
  pinned?: boolean;
  disabledReason?: string;
}

/** Rank picker options by label/path; an empty query keeps the incoming order. */
export function rankSearchRootOptions(options: SearchRootOption[], query: string): SearchRootOption[] {
  if (!normalizeQuickAccessQuery(query)) return options;
  return options
    .map((option) => ({
      option,
      match: fuzzyMatchPath(`${option.label}/${option.detail}`, query)
    }))
    .filter((entry): entry is { option: SearchRootOption; match: FuzzyPathMatch } => Boolean(entry.match))
    .sort((a, b) => b.match.score - a.match.score || a.option.label.localeCompare(b.option.label))
    .map((entry) => entry.option);
}
