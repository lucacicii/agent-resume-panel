import * as assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import {
  discoverRoles,
  discoverEnabledRoles,
  normalizeRoleRecord,
  personaToText,
  readRolesFile,
  renderRolePreamble,
  resolveRole,
  resolveThunderHome,
  roleAllowsExec,
  roleAllowsWrite
} from "../dist/index.js";

async function tempDir() {
  return await fs.mkdtemp(path.join(os.tmpdir(), "arp-roles-"));
}

const PLAN = {
  id: "plan",
  name: "Plan",
  aliases: ["p"],
  persona: ["You plan first.", "Never write files."],
  permission: "read",
  askUser: true,
  exitGate: true,
  enabled: true
};

async function writeRoles(filePath, records) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, records.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
}

test("normalizeRoleRecord applies defaults and flattens persona", () => {
  const role = normalizeRoleRecord(PLAN, { filePath: "/x/roles.jsonl", fileName: "roles.jsonl" });
  assert.ok(role);
  assert.equal(role.id, "plan");
  assert.equal(role.name, "Plan");
  assert.deepEqual(role.aliases, ["p"]);
  assert.equal(role.persona, "You plan first.\nNever write files.");
  assert.equal(role.permission, "read");
  assert.equal(role.askUser, true);
  assert.equal(role.exitGate, true);
  assert.equal(role.enabled, true);
});

test("normalizeRoleRecord defaults permission to read and enabled to true", () => {
  const role = normalizeRoleRecord({ id: "bare" }, { filePath: "/f", fileName: "f" });
  assert.ok(role);
  assert.equal(role.permission, "read");
  assert.equal(role.enabled, true);
  assert.equal(role.askUser, false);
  assert.deepEqual(role.aliases, []);
  assert.equal(role.name, "bare", "name falls back to id");
});

test("normalizeRoleRecord rejects rows without a usable id", () => {
  for (const bad of [null, undefined, 42, "str", {}, { id: "   " }, { id: 7 }]) {
    assert.equal(normalizeRoleRecord(bad, { filePath: "/f", fileName: "f" }), null);
  }
});

test("snake_case aliases are accepted alongside camelCase", () => {
  const role = normalizeRoleRecord(
    { id: "x", ask_user: true, exit_gate: true, thinking_level: "high" },
    { filePath: "/f", fileName: "f" }
  );
  assert.ok(role);
  assert.equal(role.askUser, true);
  assert.equal(role.exitGate, true);
  assert.equal(role.thinkingLevel, "high");
});

test("an invalid permission string falls back to read", () => {
  const role = normalizeRoleRecord({ id: "x", permission: "root" }, { filePath: "/f", fileName: "f" });
  assert.ok(role);
  assert.equal(role.permission, "read");
});

test("readRolesFile skips malformed lines without losing valid ones", async () => {
  const dir = await tempDir();
  const file = path.join(dir, "roles.jsonl");
  await fs.writeFile(
    file,
    [
      JSON.stringify({ id: "good" }),
      "{ this is not json",
      "",
      JSON.stringify({ id: "also_good", permission: "bash" })
    ].join("\n") + "\n",
    "utf8"
  );

  const roles = await readRolesFile(file);
  assert.equal(roles.length, 2, "two valid rows survive one bad row");
  assert.deepEqual(roles.map((r) => r.id).sort(), ["also_good", "good"]);
});

test("readRolesFile returns [] for a missing file", async () => {
  assert.deepEqual(await readRolesFile(path.join(await tempDir(), "nope.jsonl")), []);
});

test("discoverRoles merges global then project, project overriding by id", async () => {
  const home = await tempDir();
  const project = await tempDir();
  const thunderHome = path.join(home, ".thunder");

  await writeRoles(path.join(thunderHome, "roles.jsonl"), [
    { id: "plan", name: "Global Plan", permission: "bash" },
    { id: "global_only", permission: "read" }
  ]);
  await writeRoles(path.join(project, ".arp", "roles.jsonl"), [
    { id: "plan", name: "Project Plan", permission: "read" }
  ]);

  const roles = await discoverRoles({ projectPath: project, thunderHome });
  const plan = roles.find((r) => r.id === "plan");
  assert.ok(plan);
  assert.equal(plan.name, "Project Plan", "project scope wins");
  assert.equal(plan.permission, "read");
  assert.equal(roles.filter((r) => r.id === "plan").length, 1, "same id does not duplicate");
  assert.ok(roles.some((r) => r.id === "global_only"), "global-only roles survive");
});

test("discoverEnabledRoles filters disabled roles", async () => {
  const thunderHome = await tempDir();
  await writeRoles(path.join(thunderHome, "roles.jsonl"), [
    { id: "on", enabled: true },
    { id: "off", enabled: false }
  ]);

  const all = await discoverRoles({ thunderHome });
  assert.equal(all.length, 2);

  const enabled = await discoverEnabledRoles({ thunderHome });
  assert.deepEqual(enabled.map((r) => r.id), ["on"]);
  assert.equal(all[0].id, "on", "enabled roles sort first");
});

test("resolveRole matches id, alias, case-insensitively and with a leading slash", () => {
  const roles = [
    { id: "plan", aliases: ["p"] },
    { id: "reviewer", aliases: [] }
  ];
  assert.equal(resolveRole(roles, "plan")?.id, "plan");
  assert.equal(resolveRole(roles, "/plan")?.id, "plan");
  assert.equal(resolveRole(roles, "P")?.id, "plan");
  assert.equal(resolveRole(roles, "reviewer")?.id, "reviewer");
  assert.equal(resolveRole(roles, "review"), undefined);
});

test("resolveThunderHome honours explicit, env, then HOME", () => {
  assert.equal(resolveThunderHome({ thunderHome: "/explicit" }), "/explicit");
  assert.equal(resolveThunderHome({ thunderHome: null, userHome: "/home/u" }), "/home/u/.thunder");
});

test("renderRolePreamble states the capability tier", () => {
  const read = renderRolePreamble({
    id: "plan",
    name: "Plan",
    persona: "Plan only.",
    permission: "read",
    aliases: [],
    askUser: true,
    exitGate: true,
    enabled: true,
    triggers: [],
    filePath: "/f",
    fileName: "f"
  });
  assert.match(read, /\[Active Role: Plan\]/);
  assert.match(read, /read-only \(fs_write=off, bash=off\)/);
  assert.match(read, /Plan only\./);
  assert.match(read, /\[End Role\]/);
});

test("permission helpers agree with the Rust ladder", () => {
  assert.equal(roleAllowsWrite("read"), false);
  assert.equal(roleAllowsWrite("write"), true);
  assert.equal(roleAllowsWrite("bash"), true);
  assert.equal(roleAllowsExec("read"), false);
  assert.equal(roleAllowsExec("write"), false);
  assert.equal(roleAllowsExec("bash"), true);
});

test("personaToText handles string, array and missing", () => {
  assert.equal(personaToText("a"), "a");
  assert.equal(personaToText(["a", "b"]), "a\nb");
  assert.equal(personaToText(undefined), "");
});
