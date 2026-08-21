import test from "node:test";
import assert from "node:assert/strict";
import { buildNewSessionCommand, supportsNewSessionYoloMode } from "../dist/index.js";

test("supportsNewSessionYoloMode accurately identifies providers with YOLO support", () => {
  assert.equal(supportsNewSessionYoloMode("codex"), true);
  assert.equal(supportsNewSessionYoloMode("claude"), true);
  assert.equal(supportsNewSessionYoloMode("agy"), true);
  assert.equal(supportsNewSessionYoloMode("grok"), true);
  assert.equal(supportsNewSessionYoloMode("opencode"), true);
  assert.equal(supportsNewSessionYoloMode("prime"), true);
  assert.equal(supportsNewSessionYoloMode("cursor"), true);
  assert.equal(supportsNewSessionYoloMode("pi"), false);
  assert.equal(supportsNewSessionYoloMode("cursor-ide"), false);
  assert.equal(supportsNewSessionYoloMode("chat"), false);
});

test("buildNewSessionCommand keeps standard commands unchanged", () => {
  assert.equal(buildNewSessionCommand("codex", "/work/app", "standard"), "codex --cd '/work/app'");
  assert.equal(buildNewSessionCommand("claude", "/work/app", "standard"), "claude");
});

test("buildNewSessionCommand enables provider-specific YOLO flags", () => {
  assert.equal(buildNewSessionCommand("codex", "/work/app", "yolo"), "codex --cd '/work/app' --dangerously-bypass-approvals-and-sandbox");
  assert.equal(buildNewSessionCommand("claude", "/work/app", "yolo"), "claude --dangerously-skip-permissions");
  assert.equal(buildNewSessionCommand("agy", "/work/app", "yolo"), "agy --dangerously-skip-permissions");
  assert.equal(buildNewSessionCommand("grok", "/work/app", "yolo"), "grok --cwd '/work/app' --permission-mode bypassPermissions --sandbox off");
  assert.equal(buildNewSessionCommand("opencode", "/work/app", "yolo"), "opencode '/work/app' --auto");
  assert.equal(buildNewSessionCommand("cursor", "/work/app", "yolo"), "cursor-agent --workspace '/work/app' --yolo --sandbox disabled --approve-mcps");
});

test("buildNewSessionCommand rejects providers without a verified YOLO mode", () => {
  assert.throws(() => buildNewSessionCommand("pi", "/work/app", "yolo"), /YOLO mode is not supported/);
  assert.throws(() => buildNewSessionCommand("cursor-ide", "/work/app", "yolo"), /YOLO mode is not supported/);
});

