import test from "node:test";
import assert from "node:assert/strict";
import {
  buildNewSessionCommand,
  buildResumeCommand,
  sessionContextFlags,
  supportsNewSessionYoloMode,
  supportsSessionContext
} from "../dist/index.js";

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

test("supportsSessionContext identifies providers with verified session context flags", () => {
  assert.equal(supportsSessionContext("codex"), true);
  assert.equal(supportsSessionContext("claude"), true);
  assert.equal(supportsSessionContext("pi"), true);
  assert.equal(supportsSessionContext("prime"), true);
  assert.equal(supportsSessionContext("agy"), false);
  assert.equal(supportsSessionContext("cursor"), false);
  assert.equal(supportsSessionContext("opencode"), false);
});

test("sessionContextFlags crafts provider-specific extra prompt flags", () => {
  assert.equal(
    sessionContextFlags("codex", "/tmp/ws/AGENTS.md"),
    "-c \"developer_instructions=$(cat '/tmp/ws/AGENTS.md')\""
  );
  assert.equal(
    sessionContextFlags("claude", "/tmp/ws/AGENTS.md"),
    "--append-system-prompt \"$(cat '/tmp/ws/AGENTS.md')\""
  );
  assert.equal(
    sessionContextFlags("pi", "/tmp/ws/AGENTS.md"),
    "--append-system-prompt \"$(cat '/tmp/ws/AGENTS.md')\""
  );
  assert.equal(
    sessionContextFlags("prime", "/tmp/ws/AGENTS.md"),
    "--append-system-prompt \"$(cat '/tmp/ws/AGENTS.md')\""
  );
  assert.equal(sessionContextFlags("agy", "/tmp/ws/AGENTS.md"), "");
});

test("buildNewSessionCommand and buildResumeCommand append the context flag", () => {
  const file = "/tmp/ws/AGENTS.md";
  assert.equal(
    buildNewSessionCommand("codex", "/work/app", "standard", file),
    "codex --cd '/work/app' -c \"developer_instructions=$(cat '/tmp/ws/AGENTS.md')\""
  );
  assert.equal(
    buildNewSessionCommand("claude", "/work/app", "standard", file),
    "claude --append-system-prompt \"$(cat '/tmp/ws/AGENTS.md')\""
  );
  // Unsupported providers are left unchanged.
  assert.equal(buildNewSessionCommand("agy", "/work/app", "standard", file), "agy");

  const session = {
    id: "sess-1",
    provider: "claude",
    projectPath: "/work/app",
    title: "test",
    updatedAt: 1
  };
  assert.equal(
    buildResumeCommand(session, file),
    "claude --resume 'sess-1' --append-system-prompt \"$(cat '/tmp/ws/AGENTS.md')\""
  );

  const codexSession = {
    id: "sess-2",
    provider: "codex",
    projectPath: "/work/app",
    title: "test",
    updatedAt: 1
  };
  assert.equal(
    buildResumeCommand(codexSession, file),
    "codex resume --cd '/work/app' 'sess-2' -c \"developer_instructions=$(cat '/tmp/ws/AGENTS.md')\""
  );
});


