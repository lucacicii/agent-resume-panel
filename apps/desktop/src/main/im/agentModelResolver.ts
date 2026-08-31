import * as fs from "node:fs/promises";
import * as path from "node:path";
import { expandHome, type PanelSettings } from "@agent-resume/core";
import { getLiveAcpAgentModels } from "../acp/acpHost";
import { IM_AGENT_SUGGESTED_MODELS, type ImAgent, type ImAgentModelOption } from "./types";

/**
 * Loads models configured in Pi's native directory (~/.pi/agent).
 * Reads models.json, models-store.json, and settings.json.
 */
async function loadPiNativeModels(piHomeDir?: string): Promise<ImAgentModelOption[]> {
  const models: ImAgentModelOption[] = [];
  const home = path.resolve(expandHome(piHomeDir?.trim() || "~/.pi/agent"));

  // 1. models.json
  try {
    const raw = await fs.readFile(path.join(home, "models.json"), "utf8");
    const json = JSON.parse(raw) as { providers?: Record<string, { name?: string; models?: Array<{ id?: string; name?: string }> }> };
    if (json?.providers && typeof json.providers === "object") {
      for (const [providerKey, p] of Object.entries(json.providers)) {
        const pName = p?.name || providerKey;
        if (Array.isArray(p?.models)) {
          for (const m of p.models) {
            const id = typeof m?.id === "string" ? m.id.trim() : "";
            if (id) {
              const name = typeof m.name === "string" && m.name.trim() ? m.name.trim() : id;
              models.push({ id, label: `${name} (${pName})`, provider: pName });
            }
          }
        }
      }
    }
  } catch {
    // optional
  }

  // 2. models-store.json
  try {
    const raw = await fs.readFile(path.join(home, "models-store.json"), "utf8");
    const json = JSON.parse(raw) as Record<string, { name?: string; models?: Array<{ id?: string; name?: string }> }>;
    if (json && typeof json === "object") {
      for (const [providerKey, p] of Object.entries(json)) {
        const pName = p?.name || providerKey;
        if (Array.isArray(p?.models)) {
          for (const m of p.models) {
            const id = typeof m?.id === "string" ? m.id.trim() : "";
            if (id) {
              const name = typeof m.name === "string" && m.name.trim() ? m.name.trim() : id;
              models.push({ id, label: `${name} (${pName})`, provider: pName });
            }
          }
        }
      }
    }
  } catch {
    // optional
  }

  // 3. settings.json
  try {
    const raw = await fs.readFile(path.join(home, "settings.json"), "utf8");
    const json = JSON.parse(raw) as { defaultModel?: string; enabledModels?: string[] };
    if (typeof json?.defaultModel === "string" && json.defaultModel.trim()) {
      const id = json.defaultModel.trim();
      models.push({ id, label: `${id} (Pi Default)`, provider: "Pi" });
    }
    if (Array.isArray(json?.enabledModels)) {
      for (const item of json.enabledModels) {
        const id = typeof item === "string" ? item.trim() : "";
        if (id) models.push({ id, label: id, provider: "Pi" });
      }
    }
  } catch {
    // optional
  }

  return models;
}

/**
 * Loads models configured in Codex's native directory (~/.codex).
 */
async function loadCodexNativeModels(codexHomeDir?: string): Promise<ImAgentModelOption[]> {
  const models: ImAgentModelOption[] = [];
  const home = path.resolve(expandHome(codexHomeDir?.trim() || "~/.codex"));

  try {
    const raw = await fs.readFile(path.join(home, "cc-switch-model-catalog.json"), "utf8");
    const json = JSON.parse(raw) as { models?: Array<{ id?: string; display_name?: string; description?: string }> };
    if (Array.isArray(json?.models)) {
      for (const m of json.models) {
        const id = typeof m?.id === "string" ? m.id.trim() : "";
        if (id) {
          const name = m.display_name || m.description || id;
          models.push({ id, label: `${name} (Codex)`, provider: "Codex" });
        }
      }
    }
  } catch {
    // optional
  }

  return models;
}

/**
 * Loads models configured in Claude Code's native directory (~/.claude).
 */
async function loadClaudeNativeModels(claudeHomeDir?: string): Promise<ImAgentModelOption[]> {
  const models: ImAgentModelOption[] = [];
  const home = path.resolve(expandHome(claudeHomeDir?.trim() || "~/.claude"));

  try {
    const raw = await fs.readFile(path.join(home, "settings.json"), "utf8");
    const json = JSON.parse(raw) as { env?: Record<string, string> };
    if (json?.env && typeof json.env === "object") {
      for (const [k, v] of Object.entries(json.env)) {
        if (typeof v === "string" && v.trim() && (k.includes("MODEL") || k.includes("SONNET") || k.includes("OPUS") || k.includes("HAIKU"))) {
          if (!v.includes("PROXY_MANAGED") && !v.includes("http")) {
            models.push({ id: v.trim(), label: `${v.trim()} (Claude Settings)`, provider: "Claude Code" });
          }
        }
      }
    }
  } catch {
    // optional
  }

  return models;
}

/**
 * Comprehensive discovery of models for a specific IM Agent across:
 * 1. Live ACP sessions
 * 2. Native CLI config files (Pi, Codex, Claude)
 * 3. Desktop Provider Pool
 * 4. Curated suggested fallback models
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

  // 1. Live ACP controllers in memory
  try {
    const liveModels = getLiveAcpAgentModels(agent);
    for (const m of liveModels) {
      add(m.id, m.label, "ACP");
    }
  } catch {
    // optional
  }

  // 2. Native agent configuration files
  if (agent === "pi") {
    const piModels = await loadPiNativeModels(settings.agentHomes?.piHome);
    for (const m of piModels) {
      add(m.id, m.label, m.provider);
    }
  } else if (agent === "codex") {
    const codexModels = await loadCodexNativeModels(settings.agentHomes?.codexHome);
    for (const m of codexModels) {
      add(m.id, m.label, m.provider);
    }
  } else if (agent === "claude") {
    const claudeModels = await loadClaudeNativeModels(settings.agentHomes?.claudeHome);
    for (const m of claudeModels) {
      add(m.id, m.label, m.provider);
    }
  }

  // 3. Desktop Provider Pool
  if (Array.isArray(settings.providers)) {
    for (const p of settings.providers) {
      if (!p || !Array.isArray(p.models)) continue;
      for (const m of p.models) {
        if (!m || (m.kind && m.kind !== "text")) continue;
        const id = typeof m.id === "string" ? m.id.trim() : "";
        if (!id) continue;
        add(id, `${id} (${p.name || "Provider"})`, p.name || p.id);
      }
    }
  }

  // 4. Built-in curated suggestions
  const curated = IM_AGENT_SUGGESTED_MODELS[agent] || [];
  for (const m of curated) {
    if (m.id) add(m.id, m.label, "Default");
  }

  return result;
}
