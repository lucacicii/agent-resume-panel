import assert from "node:assert/strict";
import test from "node:test";
import { THUNDER_PERMISSION_MODES, normalizeThunderPermissionMode } from "../dist/index.js";

test("offers exactly the two modes Thunder implements", () => {
  assert.deepEqual(THUNDER_PERMISSION_MODES, ["plan", "yolo"]);
});

test("folds the retired ask / acceptEdits names into yolo", () => {
  // The daemon still parses them but has no approval gate to attach them to,
  // so a session carrying one runs exactly like yolo.
  for (const legacy of ["ask", "acceptEdits", "accept_edits", "autoEdit", "auto_edit"]) {
    assert.equal(normalizeThunderPermissionMode(legacy), "yolo", legacy);
  }
});

test("accepts the aliases the daemon itself normalizes", () => {
  assert.equal(normalizeThunderPermissionMode("bypass"), "yolo");
  assert.equal(normalizeThunderPermissionMode("bypassPermissions"), "yolo");
  assert.equal(normalizeThunderPermissionMode("default"), "yolo");
});

test("keeps plan as plan, whatever the casing", () => {
  assert.equal(normalizeThunderPermissionMode("plan"), "plan");
  assert.equal(normalizeThunderPermissionMode("  PLAN "), "plan");
  assert.equal(normalizeThunderPermissionMode("yolo"), "yolo");
});

test("reports an unknown or missing mode as unknown, never as a mode", () => {
  assert.equal(normalizeThunderPermissionMode(undefined), "");
  assert.equal(normalizeThunderPermissionMode(null), "");
  assert.equal(normalizeThunderPermissionMode(""), "");
  assert.equal(normalizeThunderPermissionMode("never-heard-of-it"), "");
});
