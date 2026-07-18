import assert from "node:assert/strict";
import { runDesktopDoctor } from "./doctor-desktop.mjs";

const checks = runDesktopDoctor();
assert.ok(Array.isArray(checks));
assert.ok(checks.length >= 5);
for (const c of checks) {
  assert.equal(typeof c.ok, "boolean");
  assert.equal(typeof c.name, "string");
  assert.equal(typeof c.detail, "string");
}

const names = new Set(checks.map((c) => c.name));
assert.ok(names.has("Node.js"));
assert.ok(names.has("pnpm"));
assert.ok(names.has("Platform"));
assert.ok(names.has("node-pty"));
assert.ok(names.has("Electron (dev binary)"));

console.log("doctor-desktop.test.mjs: all assertions passed");
