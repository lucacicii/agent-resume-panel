/**
 * Manifest registry: which rules apply to which agent.
 *
 * Rules are *layered*. The `generic` manifest is the base layer — approval
 * dialogs, option lists, localized prompts — and it runs for every pane. An
 * agent manifest adds the rules only that agent's UI needs (its own prompt box,
 * its spinner, its transcript viewer) and, because per-agent rules are listed
 * first and carry higher priorities, wins any disagreement.
 *
 * Layering exists so per-agent precision does not cost cross-agent safety: a
 * `claude` pane still gets the generic rules, and a bug in `claude.json` cannot
 * make every other agent blind.
 *
 * Bundled manifests live next to the compiled engine (`manifests/*.json`) and are
 * copied there by the desktop build. A local override directory
 * (`<panelHome>/.desktop/agent-detection/`) wins over both.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import * as path from "node:path";
import type { AgentKind } from "../types";
import { compileManifest, type CompiledManifest } from "./manifest";

/** Base rules that apply to every agent (an unidentified pane included). */
export const GENERIC_MANIFEST_ID = "generic";

export type ManifestSource = "bundled" | "override";

export type ManifestSummary = {
  id: string;
  version: string;
  engine: number;
  rules: number;
  aliases: string[];
  source: ManifestSource;
};

export type ManifestRegistry = {
  /** Rules for a pane: its own manifest layered over the base, or null. */
  forAgent: (agent: AgentKind) => CompiledManifest | null;
  /** Layers that answer for an agent, in precedence order, for diagnostics. */
  layersFor: (agent: AgentKind) => ManifestSummary[];
  summaries: () => ManifestSummary[];
  warnings: () => readonly string[];
};

/** Absolute path of the bundled manifests, next to the compiled engine. */
export function bundledManifestDir(): string {
  return path.join(__dirname, "manifests");
}

type LoadedManifest = {
  manifest: CompiledManifest;
  source: ManifestSource;
  aliases: string[];
};

export function createManifestRegistry(input: {
  dir?: string;
  /** Local overrides; a file here replaces the bundled manifest with the same id. */
  overrideDir?: string;
  log?: (message: string) => void;
}): ManifestRegistry {
  const log = input.log ?? (() => undefined);
  const warnings: string[] = [];
  const loaded = new Map<string, LoadedManifest>();

  const sources: { dir: string; source: ManifestSource }[] = [
    { dir: input.overrideDir ?? "", source: "override" },
    { dir: input.dir ?? bundledManifestDir(), source: "bundled" }
  ];

  for (const { dir, source } of sources) {
    if (!dir || !existsSync(dir)) continue;
    for (const name of readdirSync(dir).sort()) {
      if (!name.endsWith(".json")) continue;
      const file = path.join(dir, name);
      let raw: unknown;
      try {
        raw = JSON.parse(readFileSync(file, "utf8"));
      } catch (error) {
        warnings.push(`${file}: unreadable (${describe(error)})`);
        continue;
      }
      const result = compileManifest(raw);
      if (!result.ok) {
        warnings.push(`${file}: ${result.error}`);
        log(`ignoring manifest ${name}: ${result.error}`);
        continue;
      }
      for (const warning of result.warnings) {
        warnings.push(warning);
        log(warning);
      }
      const aliases = aliasList(raw);
      // The override directory is read first, so an override wins by arriving first.
      if (loaded.has(result.manifest.id) && loaded.get(result.manifest.id)!.source === "override") {
        log(`override for ${result.manifest.id} replaces the bundled manifest`);
        continue;
      }
      loaded.set(result.manifest.id, { manifest: result.manifest, source, aliases });
      for (const alias of aliases) {
        if (!loaded.has(alias)) loaded.set(alias, { manifest: result.manifest, source, aliases });
      }
    }
  }

  const base = () => loaded.get(GENERIC_MANIFEST_ID)?.manifest ?? null;

  if (loaded.size === 0) {
    const looked = sources.filter((entry) => entry.dir).map((entry) => entry.dir);
    warnings.push(`no detection manifests loaded (looked in ${looked.join(", ") || "nothing"})`);
    log("no detection manifests loaded; every pane will settle on evidence other than rules");
  }

  function own(agent: AgentKind): LoadedManifest | null {
    const entry = loaded.get(agent);
    return entry && entry.manifest.id !== GENERIC_MANIFEST_ID ? entry : null;
  }

  function layerList(agent: AgentKind): LoadedManifest[] {
    const layers: LoadedManifest[] = [];
    const ownLayer = own(agent);
    if (ownLayer) layers.push(ownLayer);
    const baseLayer = loaded.get(GENERIC_MANIFEST_ID);
    if (baseLayer) layers.push(baseLayer);
    return layers;
  }

  return {
    forAgent(agent) {
      const layers = layerList(agent);
      if (!layers.length) return null;
      if (layers.length === 1) return layers[0]!.manifest;
      // Compose once per call; rules are shared, not copied.
      return {
        id: layers[0]!.manifest.id,
        version: layers[0]!.manifest.version,
        engine: layers[0]!.manifest.engine,
        rules: layers.flatMap((layer) => layer.manifest.rules)
      };
    },
    layersFor(agent) {
      return layerList(agent).map(summarize);
    },
    summaries() {
      const seen = new Set<CompiledManifest>();
      const list: ManifestSummary[] = [];
      for (const entry of loaded.values()) {
        if (seen.has(entry.manifest)) continue;
        seen.add(entry.manifest);
        list.push(summarize(entry));
      }
      return list;
    },
    warnings() {
      return warnings;
    }
  };
}

function summarize(entry: LoadedManifest): ManifestSummary {
  return {
    id: entry.manifest.id,
    version: entry.manifest.version,
    engine: entry.manifest.engine,
    rules: entry.manifest.rules.length,
    aliases: entry.aliases,
    source: entry.source
  };
}

function aliasList(raw: unknown): string[] {
  const aliases = (raw as { aliases?: unknown })?.aliases;
  return Array.isArray(aliases) ? aliases.filter((value): value is string => typeof value === "string") : [];
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
