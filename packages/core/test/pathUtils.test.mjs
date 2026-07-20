import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { expandHome, expandPortableKey, isForeignUserPath, toPortableKey } from "../dist/pathUtils.js";

test("expandHome rehomes foreign absolute paths to the current user", () => {
  const home = os.homedir();
  const foreign = path.join(path.dirname(home), "other-user", ".claude");
  assert.equal(expandHome(foreign), path.join(home, ".claude"));
});

test("expandHome keeps the current user's absolute paths unchanged", () => {
  const home = os.homedir();
  const current = path.join(home, ".grok");
  assert.equal(expandHome(current), current);
});

test("expandHome supports $HOME and tilde prefixes", () => {
  const home = os.homedir();
  assert.equal(expandHome("~/.codex"), path.join(home, ".codex"));
  assert.equal(expandHome("$HOME/.codex"), path.join(home, ".codex"));
});

test("toPortableKey and expandPortableKey round-trip under home", () => {
  const home = os.homedir();
  const absolute = path.join(home, "projects", "app");
  assert.equal(toPortableKey(absolute), "~/projects/app");
  assert.equal(expandPortableKey("~/projects/app"), absolute);
});

test("isForeignUserPath is false for current home and true for other users", () => {
  const home = os.homedir();
  assert.equal(isForeignUserPath(path.join(home, "x")), false);
  assert.equal(isForeignUserPath(path.join(path.dirname(home), "someone-else", "x")), true);
});