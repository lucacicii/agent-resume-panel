import * as fs from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import * as os from "node:os";
import * as path from "node:path";
import { createThunderConfigStore, type ThunderConfigStore } from "./thunderConfig";

let dirs: string[] = [];

function tempStore(): { store: ThunderConfigStore; dir: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "thunder-config-"));
  dirs.push(dir);
  return { store: createThunderConfigStore(path.join(dir, ".thunder")), dir };
}

afterEach(() => {
  for (const dir of dirs) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // Best effort cleanup.
    }
  }
  dirs = [];
});

describe("createThunderConfigStore models", () => {
  it("reads providers and utilityModel; validates shape on write", () => {
    const { store, dir } = tempStore();
    const base = path.join(dir, ".thunder");
    fs.mkdirSync(base, { recursive: true });
    fs.writeFileSync(
      path.join(base, "models.json"),
      JSON.stringify({
        providers: { p1: { name: "P1", apiKey: "sk", models: [{ id: "m1" }] } },
        utilityModel: "p1/m1"
      }),
      "utf8"
    );

    const config = store.readModelsConfig();
    expect(config.utilityModel).toBe("p1/m1");
    expect(Object.keys(config.providers)).toEqual(["p1"]);

    config.providers.p2 = { name: "P2", apiKey: "k2" };
    store.writeModelsConfig(config);
    expect(Object.keys(store.readModelsConfig().providers).sort()).toEqual(["p1", "p2"]);
    expect(fs.existsSync(path.join(base, "models.json.bak"))).toBe(true);
  });

  it("rejects malformed configs", () => {
    const { store, dir } = tempStore();
    const base = path.join(dir, ".thunder");
    fs.mkdirSync(base, { recursive: true });
    fs.writeFileSync(path.join(base, "models.json"), "[]", "utf8");
    expect(() => store.readModelsConfig()).toThrow(/top-level object/);

    expect(() =>
      store.writeModelsConfig({ providers: [] as never })
    ).toThrow(/providers.*object/);
    expect(() =>
      store.writeModelsConfig({
        providers: { p: { name: "P", apiKey: "   " } }
      })
    ).toThrow(/apiKey cannot be empty/);
  });
});
