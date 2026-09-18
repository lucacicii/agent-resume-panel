/** Selection-menu actions (Translate / Explain / custom) for the desktop app. */

export const BUILTIN_SELECTION_ACTION_IDS = ["translate", "explain"] as const;
type BuiltinSelectionActionId = (typeof BUILTIN_SELECTION_ACTION_IDS)[number];

export function isBuiltinSelectionActionId(value: string): value is BuiltinSelectionActionId {
  return (BUILTIN_SELECTION_ACTION_IDS as readonly string[]).includes(value);
}

export interface SelectionAction {
  actionId: string;
  name: string;
  prompt: string;
  providerId?: string;
  modelId?: string;
  sortOrder: number;
  enabled: boolean;
  createdAtMs: number;
  updatedAtMs: number;
}
