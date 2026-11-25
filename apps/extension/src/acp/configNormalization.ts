import type {
  AcpConfigOption,
  AcpConfigOptionChoice,
  AcpConfigOptionGroup
} from "./types";

export type AcpSessionModes = {
  currentModeId: string;
  availableModes: Array<{ id: string; name: string }>;
};

const CATEGORY_ORDER: Record<string, number> = {
  mode: 0,
  model: 1,
  thought_level: 2,
  model_config: 3
};

function categoryRank(category?: string): number {
  if (!category) {
    return 4;
  }
  return CATEGORY_ORDER[category] ?? 4;
}

export function sortConfigOptions(options: AcpConfigOption[]): AcpConfigOption[] {
  return options
    .map((option, index) => ({ option, index }))
    .sort((a, b) => {
      const rankDiff = categoryRank(a.option.category) - categoryRank(b.option.category);
      return rankDiff !== 0 ? rankDiff : a.index - b.index;
    })
    .map(({ option }) => option);
}

function parseChoice(raw: unknown): AcpConfigOptionChoice | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const obj = raw as { value?: unknown; name?: unknown; description?: unknown };
  if (typeof obj.value !== "string" || !obj.value) {
    return undefined;
  }
  const name = typeof obj.name === "string" && obj.name ? obj.name : obj.value;
  const choice: AcpConfigOptionChoice = { value: obj.value, name };
  if (typeof obj.description === "string" && obj.description) {
    choice.description = obj.description;
  }
  return choice;
}

function parseSelectOptions(raw: unknown): {
  options: AcpConfigOptionChoice[];
  groups?: AcpConfigOptionGroup[];
} {
  if (!Array.isArray(raw)) {
    return { options: [] };
  }

  const options: AcpConfigOptionChoice[] = [];
  const groups: AcpConfigOptionGroup[] = [];

  for (const item of raw) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const candidate = item as {
      group?: unknown;
      name?: unknown;
      options?: unknown;
      value?: unknown;
    };

    if (Array.isArray(candidate.options) && typeof candidate.group === "string") {
      const groupChoices = candidate.options
        .map(parseChoice)
        .filter((choice): choice is AcpConfigOptionChoice => Boolean(choice));
      if (groupChoices.length) {
        groups.push({
          group: candidate.group,
          name:
            typeof candidate.name === "string" && candidate.name
              ? candidate.name
              : candidate.group,
          options: groupChoices
        });
        options.push(...groupChoices);
      }
      continue;
    }

    const choice = parseChoice(item);
    if (choice) {
      options.push(choice);
    }
  }

  return groups.length ? { options, groups } : { options };
}

/** Normalize an ACP `SessionConfigOption[]` payload into a uniform client list. */
export function normalizeConfigOptionsArray(raw: unknown): AcpConfigOption[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const normalized: AcpConfigOption[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const entry = item as {
      id?: unknown;
      name?: unknown;
      description?: unknown;
      category?: unknown;
      type?: unknown;
      currentValue?: unknown;
      options?: unknown;
    };

    if (typeof entry.id !== "string" || !entry.id) {
      continue;
    }
    const name = typeof entry.name === "string" && entry.name ? entry.name : entry.id;
    const description =
      typeof entry.description === "string" && entry.description ? entry.description : undefined;
    const category =
      typeof entry.category === "string" && entry.category ? entry.category : undefined;

    if (entry.type === "boolean") {
      if (typeof entry.currentValue === "boolean") {
        normalized.push({
          id: entry.id,
          name,
          ...(description ? { description } : {}),
          ...(category ? { category } : {}),
          type: "boolean",
          currentValue: entry.currentValue,
          source: "configOption"
        });
      }
      continue;
    }

    if (entry.type === "select" || Array.isArray(entry.options)) {
      const { options, groups } = parseSelectOptions(entry.options);
      const currentValue =
        typeof entry.currentValue === "string"
          ? entry.currentValue
          : (options[0]?.value ?? "");
      normalized.push({
        id: entry.id,
        name,
        ...(description ? { description } : {}),
        ...(category ? { category } : {}),
        type: "select",
        currentValue,
        options,
        ...(groups ? { groups } : {}),
        source: "configOption"
      });
    }
  }

  return sortConfigOptions(normalized);
}

/**
 * Unify ACP `configOptions`, legacy `modes`, and legacy `models` from session/new,
 * session/load, or session/resume responses into one deterministic control list.
 */
export function normalizeSessionConfigOptions(
  response: Record<string, unknown> | null | undefined
): { modes: AcpSessionModes | null; configOptions: AcpConfigOption[] } {
  const configOptions = normalizeConfigOptionsArray(response?.configOptions);
  const hasExplicitConfigOptions = configOptions.length > 0;

  let modes: AcpSessionModes | null = null;
  const rawModes = response?.modes;
  if (rawModes && typeof rawModes === "object") {
    const rawCurrentModeId = (rawModes as { currentModeId?: unknown }).currentModeId;
    const rawAvailableModes = (rawModes as { availableModes?: unknown }).availableModes;
    if (Array.isArray(rawAvailableModes)) {
      const availableModes = rawAvailableModes
        .map((entry) => {
          if (!entry || typeof entry !== "object") {
            return undefined;
          }
          const mode = entry as { id?: unknown; name?: unknown };
          if (typeof mode.id !== "string" || !mode.id) {
            return undefined;
          }
          return {
            id: mode.id,
            name: typeof mode.name === "string" && mode.name ? mode.name : mode.id
          };
        })
        .filter((entry): entry is { id: string; name: string } => Boolean(entry));

      if (availableModes.length) {
        const currentModeId =
          typeof rawCurrentModeId === "string" && rawCurrentModeId
            ? rawCurrentModeId
            : availableModes[0].id;
        modes = { currentModeId, availableModes };

        if (!hasExplicitConfigOptions) {
          configOptions.push({
            id: "mode",
            name: "Mode",
            category: "mode",
            type: "select",
            currentValue: currentModeId,
            options: availableModes.map((mode) => ({
              value: mode.id,
              name: mode.name
            })),
            source: "mode"
          });
        }
      }
    }
  }

  if (!modes) {
    const modeConfig = configOptions.find(
      (option): option is Extract<AcpConfigOption, { type: "select" }> =>
        option.type === "select" && option.category === "mode"
    );
    if (modeConfig && modeConfig.options.length) {
      modes = {
        currentModeId: modeConfig.currentValue,
        availableModes: modeConfig.options.map((opt) => ({ id: opt.value, name: opt.name }))
      };
    }
  }

  if (!hasExplicitConfigOptions) {
    const rawModels = response?.models;
    if (rawModels && typeof rawModels === "object") {
      const rawCurrentModelId = (rawModels as { currentModelId?: unknown }).currentModelId;
      const rawAvailableModels = (rawModels as { availableModels?: unknown }).availableModels;
      if (Array.isArray(rawAvailableModels)) {
        const modelChoices = rawAvailableModels
          .map((entry) => {
            if (!entry || typeof entry !== "object") {
              return undefined;
            }
            const model = entry as { modelId?: unknown; name?: unknown; description?: unknown };
            if (typeof model.modelId !== "string" || !model.modelId) {
              return undefined;
            }
            const choice: AcpConfigOptionChoice = {
              value: model.modelId,
              name:
                typeof model.name === "string" && model.name ? model.name : model.modelId
            };
            if (typeof model.description === "string" && model.description) {
              choice.description = model.description;
            }
            return choice;
          })
          .filter((entry): entry is AcpConfigOptionChoice => Boolean(entry));

        if (modelChoices.length) {
          const currentModelId =
            typeof rawCurrentModelId === "string" && rawCurrentModelId
              ? rawCurrentModelId
              : modelChoices[0].value;
          configOptions.push({
            id: "model",
            name: "Model",
            category: "model",
            type: "select",
            currentValue: currentModelId,
            options: modelChoices,
            source: "model"
          });
        }
      }
    }
  }

  return {
    modes,
    configOptions: sortConfigOptions(configOptions)
  };
}
