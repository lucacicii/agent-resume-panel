import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createManifestRegistry } from "./registry";

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "agent-status-registry-"));
  tempDirs.push(dir);
  return dir;
}

function writeManifest(dir: string, name: string, manifest: unknown): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, name), typeof manifest === "string" ? manifest : JSON.stringify(manifest, null, 2));
}

function manifest(id: string, rules: { id: string; contains: string[] }[]) {
  return {
    id,
    version: "1.0.0",
    engine: 2,
    rules: rules.map((rule) => ({
      id: rule.id,
      state: "blocked",
      region: "whole_recent",
      contains: rule.contains
    }))
  };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("createManifestRegistry", () => {
  it("loads bundled manifests and layers the base under the agent", () => {
    const dir = tempDir();
    writeManifest(dir, "generic.json", manifest("generic", [{ id: "base", contains: ["base"] }]));
    writeManifest(dir, "claude.json", manifest("claude", [{ id: "own", contains: ["own"] }]));

    const registry = createManifestRegistry({ dir });
    expect(registry.forAgent("claude")?.rules.map((rule) => rule.id)).toEqual(["own", "base"]);
    expect(registry.forAgent("grok")?.rules.map((rule) => rule.id)).toEqual(["base"]);
    expect(registry.forAgent("claude")?.rules[0]?.manifest).toBe("claude");
    expect(registry.forAgent("claude")?.rules[1]?.manifest).toBe("generic");
    expect(registry.layersFor("claude").map((layer) => layer.id)).toEqual(["claude", "generic"]);
    expect(registry.warnings()).toEqual([]);
  });

  it("lets a local override replace the bundled manifest with the same id", () => {
    const bundled = tempDir();
    const overrides = tempDir();
    writeManifest(bundled, "generic.json", manifest("generic", [{ id: "base", contains: ["base"] }]));
    writeManifest(bundled, "claude.json", manifest("claude", [{ id: "bundled-rule", contains: ["a"] }]));
    writeManifest(overrides, "claude.json", manifest("claude", [{ id: "override-rule", contains: ["b"] }]));

    const registry = createManifestRegistry({ dir: bundled, overrideDir: overrides });
    const claude = registry.forAgent("claude");
    expect(claude?.rules.map((rule) => rule.id)).toEqual(["override-rule", "base"]);
    expect(registry.layersFor("claude")[0]).toMatchObject({ id: "claude", source: "override" });
    expect(registry.layersFor("claude")[1]).toMatchObject({ id: "generic", source: "bundled" });
  });

  it("resolves aliases and reports each manifest once", () => {
    const dir = tempDir();
    writeManifest(dir, "generic.json", manifest("generic", [{ id: "base", contains: ["x"] }]));
    writeManifest(dir, "claude.json", {
      ...manifest("claude", [{ id: "own", contains: ["y"] }]),
      aliases: ["claude-code"]
    });

    const registry = createManifestRegistry({ dir });
    expect(registry.forAgent("claude-code" as never)?.id).toBe("claude");
    expect(registry.summaries().map((summary) => summary.id).sort()).toEqual(["claude", "generic"]);
    expect(registry.summaries().find((summary) => summary.id === "claude")?.aliases).toEqual(["claude-code"]);
  });

  it("keeps working manifests when a sibling file is broken", () => {
    const dir = tempDir();
    writeManifest(dir, "generic.json", manifest("generic", [{ id: "base", contains: ["x"] }]));
    writeManifest(dir, "broken.json", "{ not json");
    writeManifest(dir, "wrong.json", { id: "wrong", version: "1", engine: 99, rules: [] });

    const registry = createManifestRegistry({ dir });
    expect(registry.forAgent("unknown")?.id).toBe("generic");
    expect(registry.warnings().join("\n")).toMatch(/unreadable/);
    expect(registry.warnings().join("\n")).toMatch(/engine/);
  });

  it("returns null when there is nothing to load", () => {
    const registry = createManifestRegistry({ dir: path.join(tempDir(), "missing") });
    expect(registry.forAgent("claude")).toBeNull();
    expect(registry.layersFor("claude")).toEqual([]);
    expect(registry.warnings().join("\n")).toMatch(/no detection manifests loaded/);
  });
});
