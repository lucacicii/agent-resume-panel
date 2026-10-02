import * as fs from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import * as os from "node:os";
import * as path from "node:path";
import {
  BUILT_IN_ROLE_IDS,
  createThunderConfigStore,
  type ThunderConfigStore
} from "./thunderConfig";

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

describe("createThunderConfigStore roles", () => {
  it("creates the file with every built-in role when none exists", () => {
    const { store } = tempStore();
    const { ensured } = store.ensureBuiltinRoles();
    expect([...ensured].sort()).toEqual(["architect", "coder", "plan", "pm"]);
    const records = store.readRolesFile();
    expect(records.map((r) => String(r.raw.id)).sort()).toEqual([
      "architect",
      "coder",
      "plan",
      "pm"
    ]);
    expect(records.every((r) => r.builtin)).toBe(true);
  });

  it("appends only missing built-ins and never overwrites a user's definition", () => {
    const { store, dir } = tempStore();
    const file = path.join(dir, ".thunder", "roles.jsonl");
    fs.mkdirSync(path.join(dir, ".thunder"), { recursive: true });
    fs.writeFileSync(
      file,
      `${JSON.stringify({ id: "plan", name: "MY PLAN", permission: "bash" })}\n` +
        `${JSON.stringify({ id: "custom", name: "Custom", permission: "read" })}\n`,
      "utf8"
    );

    const { ensured } = store.ensureBuiltinRoles();
    expect(ensured.sort()).toEqual(["architect", "coder", "pm"]);

    const records = store.readRolesFile();
    const plan = records.find((r) => r.raw.id === "plan");
    expect(plan?.raw.name).toBe("MY PLAN"); // untouched
    expect(plan?.raw.permission).toBe("bash");
    const custom = records.find((r) => r.raw.id === "custom");
    expect(custom?.builtin).toBe(false);
  });

  it("skips malformed lines without losing valid ones (mirrors the daemon reader)", () => {
    const { store, dir } = tempStore();
    const file = path.join(dir, ".thunder", "roles.jsonl");
    fs.mkdirSync(path.join(dir, ".thunder"), { recursive: true });
    fs.writeFileSync(file, "{ not json\n" + JSON.stringify({ id: "ok", permission: "read" }) + "\n", "utf8");

    const records = store.readRolesFile();
    expect(records.map((r) => String(r.raw.id))).toEqual(["ok"]);
  });

  it("round-trips unknown fields and rejects duplicates / empty ids", () => {
    const { store } = tempStore();
    const records = [
      { raw: { id: "a", permission: "read", futureField: { nested: true } }, builtin: false },
      { raw: { id: "b", persona: ["line1", "line2"] }, builtin: false }
    ];
    store.writeRolesFile(records);
    const read = store.readRolesFile();
    expect(read[0].raw.futureField).toEqual({ nested: true });
    expect(read[1].raw.persona).toEqual(["line1", "line2"]);

    expect(() =>
      store.writeRolesFile([
        { raw: { id: "a", permission: "read" }, builtin: false },
        { raw: { id: "a", permission: "write" }, builtin: false }
      ])
    ).toThrow(/Duplicate role id/);
    expect(() => store.writeRolesFile([{ raw: { id: "  " }, builtin: false }])).toThrow(
      /non-empty id/
    );
  });

  it("keeps a .bak and writes atomically", () => {
    const { store, dir } = tempStore();
    store.writeRolesFile([{ raw: { id: "a", permission: "read" }, builtin: false }]);
    store.writeRolesFile([{ raw: { id: "b", permission: "read" }, builtin: false }]);
    const file = path.join(dir, ".thunder", "roles.jsonl");
    expect(fs.existsSync(`${file}.bak`)).toBe(true);
    expect(store.readRolesFile().map((r) => String(r.raw.id))).toEqual(["b"]);
  });

  it("resets one built-in role in place", () => {
    const { store } = tempStore();
    store.ensureBuiltinRoles();
    const edited = store
      .readRolesFile()
      .map((r) =>
        r.raw.id === "plan" ? { raw: { ...r.raw, name: "TAMPERED", persona: "no rules" }, builtin: true } : r
      );
    store.writeRolesFile(edited);

    store.resetBuiltinRole("plan");
    const plan = store.readRolesFile().find((r) => r.raw.id === "plan");
    expect(plan?.raw.name).toBe("Plan");
    expect(Array.isArray(plan?.raw.persona)).toBe(true);
    expect(() => store.resetBuiltinRole("nope")).toThrow(/Not a built-in role/);
  });

  it("BUILT_IN_ROLE_IDS covers exactly plan, architect, coder, pm", () => {
    expect([...BUILT_IN_ROLE_IDS].sort()).toEqual(["architect", "coder", "plan", "pm"]);
  });
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
