import { describe, expect, it } from "vitest";
import {
  MANIFEST_ENGINE_VERSION,
  compileManifest,
  type AgentManifestFile
} from "./manifest";

function manifest(overrides: Partial<AgentManifestFile> = {}): AgentManifestFile {
  return {
    id: "test",
    version: "1",
    engine: MANIFEST_ENGINE_VERSION,
    rules: [{ id: "rule", state: "blocked", region: "whole_recent", contains: ["yes"] }],
    ...overrides
  };
}

describe("compileManifest", () => {
  it("compiles a manifest and its rules", () => {
    const result = compileManifest(manifest());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.id).toBe("test");
    expect(result.manifest.rules).toHaveLength(1);
    expect(result.manifest.rules[0]?.priority).toBe(0);
    expect(result.warnings).toEqual([]);
  });

  it("rejects an object without an id, version, or rules", () => {
    expect(compileManifest(null).ok).toBe(false);
    expect(compileManifest({ version: "1", rules: [] }).ok).toBe(false);
    expect(compileManifest({ id: "x", rules: [] }).ok).toBe(false);
    expect(compileManifest({ id: "x", version: "1" }).ok).toBe(false);
  });

  it("refuses a manifest that asks for a newer engine", () => {
    const result = compileManifest(manifest({ engine: MANIFEST_ENGINE_VERSION + 1 }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/engine/);
  });

  it("drops unusable rules and keeps the rest, with a warning", () => {
    const result = compileManifest(manifest({
      rules: [
        { id: "bad-state", state: "sleeping" as never, region: "whole_recent" },
        { id: "bad-region", state: "blocked", region: "nowhere" },
        { state: "blocked", region: "whole_recent" } as never,
        { id: "good", state: "idle", region: "whole_recent", contains: ["ok"] }
      ]
    }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.rules.map((rule) => rule.id)).toEqual(["good"]);
    expect(result.warnings.join("\n")).toMatch(/invalid state/);
    expect(result.warnings.join("\n")).toMatch(/unknown region/);
  });

  it("drops an invalid regex instead of failing the rule", () => {
    const result = compileManifest(manifest({
      rules: [{ id: "rule", state: "blocked", region: "whole_recent", regex: ["([unclosed", "ok"] }]
    }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.rules[0]?.regex.map((pattern) => pattern.source)).toEqual(["ok"]);
    expect(result.warnings.join("\n")).toMatch(/invalid regex/);
  });

  it("fails when nothing usable is left", () => {
    const result = compileManifest(manifest({ rules: [{ id: "x", state: "nope" as never, region: "whole_recent" }] }));
    expect(result.ok).toBe(false);
  });

  it("ignores a duplicate rule id", () => {
    const result = compileManifest(manifest({
      rules: [
        { id: "same", state: "blocked", region: "whole_recent" },
        { id: "same", state: "idle", region: "whole_recent" }
      ]
    }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.rules).toHaveLength(1);
    expect(result.warnings.join("\n")).toMatch(/duplicate rule id/);
  });

  it("compiles patterns case-insensitively", () => {
    const result = compileManifest(manifest({
      rules: [{ id: "rule", state: "blocked", region: "whole_recent", regex: ["allow"] }]
    }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.rules[0]?.regex[0]?.test("ALLOW")).toBe(true);
  });
});
