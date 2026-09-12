/**
 * Manifest registry: which rules apply to which agent.
 *
 * Bundled manifests live next to the compiled engine (`manifests/*.json`) and are
 * copied there by the desktop build. An unknown agent falls back to the
 * `generic` manifest, because "we do not know the agent" must not mean "we have
 * no rules".
 *
 * Stage 5 adds local overrides; stage 7 adds remote refresh. Both replace the
 * loader, not the evaluation.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import * as path from "node:path";
import type { AgentKind } from "../types";
import { compileManifest, type CompiledManifest } from "./manifest";

/** Rules that apply to any agent (an unidentified pane included). */
export const GENERIC_MANIFEST_ID = "generic";

export type ManifestSummary = {
  id: string;
  version: string;
  engine: number;
  rules: number;
  aliases: string[];
};

export type ManifestRegistry = {
  /** Rules for a pane, or null when even the generic manifest is unavailable. */
  forAgent: (agent: AgentKind) => CompiledManifest | null;
  summaries: () => ManifestSummary[];
  warnings: () => readonly string[];
};

/** Absolute path of the bundled manifests, next to the compiled engine. */
export function bundledManifestDir(): string {
  return path.join(__dirname, "manifests");
}

export function createManifestRegistry(input: {
  dir?: string;
  log?: (message: string) => void;
}): ManifestRegistry {
  const log = input.log ?? (() => undefined);
  const dir = input.dir ?? bundledManifestDir();
  const byId = new Map<string, CompiledManifest>();
  const warnings: string[] = [];

  if (!existsSync(dir)) {
    warnings.push(`manifest directory not found: ${dir}`);
    log(`no detection manifests at ${dir}; screen rules are disabled`);
  } else {
    for (const name of readdirSync(dir).sort()) {
      if (!name.endsWith(".json")) continue;
      const file = path.join(dir, name);
      let raw: unknown;
      try {
        raw = JSON.parse(readFileSync(file, "utf8"));
      } catch (error) {
        warnings.push(`${name}: unreadable (${describe(error)})`);
        continue;
      }
      const result = compileManifest(raw);
      if (!result.ok) {
        warnings.push(`${name}: ${result.error}`);
        log(`ignoring manifest ${name}: ${result.error}`);
        continue;
      }
      for (const warning of result.warnings) {
        warnings.push(warning);
        log(warning);
      }
      byId.set(result.manifest.id, result.manifest);
      for (const alias of aliasList(raw)) {
        if (!byId.has(alias)) byId.set(alias, result.manifest);
      }
    }
  }

  return {
    forAgent(agent) {
      return byId.get(agent) ?? byId.get(GENERIC_MANIFEST_ID) ?? null;
    },
    summaries() {
      const seen = new Set<CompiledManifest>();
      const list: ManifestSummary[] = [];
      for (const manifest of byId.values()) {
        if (seen.has(manifest)) continue;
        seen.add(manifest);
        list.push({
          id: manifest.id,
          version: manifest.version,
          engine: manifest.engine,
          rules: manifest.rules.length,
          aliases: [...byId.entries()]
            .filter(([key, value]) => value === manifest && key !== manifest.id)
            .map(([key]) => key)
        });
      }
      return list;
    },
    warnings() {
      return warnings;
    }
  };
}

function aliasList(raw: unknown): string[] {
  const aliases = (raw as { aliases?: unknown })?.aliases;
  return Array.isArray(aliases) ? aliases.filter((value): value is string => typeof value === "string") : [];
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
