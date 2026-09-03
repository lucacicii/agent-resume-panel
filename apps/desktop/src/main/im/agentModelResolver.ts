import type { PanelSettings } from "@agent-resume/core";
import { IM_AGENT_SUGGESTED_MODELS, type ImAgent, type ImAgentModelOption } from "./types";

/**
 * Discovers models for an IM Agent from the Desktop Provider Pool (`settings.providers`).
 * Retrieves all text models provided by configured providers.
 */
export async function resolveAgentModels(
  agent: ImAgent,
  settings: PanelSettings
): Promise<ImAgentModelOption[]> {
  const seen = new Set<string>();
  const result: ImAgentModelOption[] = [];

  const add = (id: string, label: string, provider?: string) => {
    const trimmedId = id.trim();
    if (!trimmedId) return;
    if (seen.has(trimmedId)) return;
    seen.add(trimmedId);
    result.push({ id: trimmedId, label: label.trim() || trimmedId, provider });
  };

  // 1. Models from all configured providers in Desktop settings
  if (Array.isArray(settings?.providers)) {
    for (const p of settings.providers) {
      if (!p || !Array.isArray(p.models)) continue;
      for (const m of p.models) {
        if (!m || (m.kind && m.kind !== "text")) continue;
        const id = typeof m.id === "string" ? m.id.trim() : "";
        if (!id) continue;
        add(id, `${id} (${p.name || p.id})`, p.name || p.id);
      }
    }
  }

  // 2. Curated suggested fallback models when provider pool has no text models
  if (result.length === 0) {
    const curated = IM_AGENT_SUGGESTED_MODELS[agent] || [];
    for (const m of curated) {
      if (m.id) add(m.id, m.label, "Default");
    }
  }

  return result;
}
