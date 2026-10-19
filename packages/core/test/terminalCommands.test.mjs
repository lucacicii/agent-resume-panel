import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildNewSessionArgv,
  buildNewSessionCommand,
  buildResumeArgv,
  buildResumeCommand,
  sessionContextArgs,
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
  assert.equal(supportsNewSessionYoloMode("omp"), true);
  assert.equal(supportsNewSessionYoloMode("cursor"), true);
  assert.equal(supportsNewSessionYoloMode("pi"), false);
  assert.equal(supportsNewSessionYoloMode("cursor-ide"), false);
  assert.equal(supportsNewSessionYoloMode("chat"), false);
});

test("buildNewSessionArgv keeps standard commands as argv", () => {
  assert.deepEqual(buildNewSessionArgv("codex", "/work/app", "standard"), ["codex", "--cd", "/work/app"]);
  assert.deepEqual(buildNewSessionArgv("claude", "/work/app", "standard"), ["claude"]);
  assert.deepEqual(buildNewSessionArgv("omp", "/work/app", "standard"), ["omp"]);
});

test("buildNewSessionArgv enables provider-specific YOLO flags", () => {
  assert.deepEqual(buildNewSessionArgv("codex", "/work/app", "yolo"), [
    "codex",
    "--cd",
    "/work/app",
    "--dangerously-bypass-approvals-and-sandbox"
  ]);
  assert.deepEqual(buildNewSessionArgv("claude", "/work/app", "yolo"), [
    "claude",
    "--dangerously-skip-permissions"
  ]);
  assert.deepEqual(buildNewSessionArgv("agy", "/work/app", "yolo"), ["agy", "--dangerously-skip-permissions"]);
  assert.deepEqual(buildNewSessionArgv("grok", "/work/app", "yolo"), [
    "grok",
    "--cwd",
    "/work/app",
    "--permission-mode",
    "bypassPermissions",
    "--sandbox",
    "off"
  ]);
  assert.deepEqual(buildNewSessionArgv("opencode", "/work/app", "yolo"), ["opencode", "/work/app", "--auto"]);
  assert.deepEqual(buildNewSessionArgv("cursor", "/work/app", "yolo"), [
    "cursor-agent",
    "--workspace",
    "/work/app",
    "--yolo",
    "--sandbox",
    "disabled",
    "--approve-mcps"
  ]);
  assert.deepEqual(buildNewSessionArgv("omp", "/work/app", "yolo"), ["omp", "--auto-approve"]);
});

test("buildNewSessionArgv rejects providers without a verified YOLO mode", () => {
  assert.throws(() => buildNewSessionArgv("pi", "/work/app", "yolo"), /YOLO mode is not supported/);
  assert.throws(() => buildNewSessionArgv("cursor-ide", "/work/app", "yolo"), /YOLO mode is not supported/);
});

test("command strings quote for the shell that will run them", () => {
  assert.equal(buildNewSessionCommand("codex", "/work/my app", "standard", undefined, "posix"), "codex --cd '/work/my app'");
  assert.equal(
    buildNewSessionCommand("codex", "C:\\work\\my app", "standard", undefined, "powershell"),
    "codex --cd 'C:\\work\\my app'"
  );
  assert.equal(
    buildNewSessionCommand("codex", "C:\\work\\my app", "standard", undefined, "cmd"),
    'codex --cd "C:\\work\\my app"'
  );
  // PowerShell doubles single quotes instead of closing and reopening them.
  assert.equal(
    buildNewSessionCommand("codex", "/work/it's", "standard", undefined, "powershell"),
    "codex --cd '/work/it''s'"
  );
});

test("supportsSessionContext identifies providers with verified session context flags", () => {
  assert.equal(supportsSessionContext("codex"), true);
  assert.equal(supportsSessionContext("claude"), true);
  assert.equal(supportsSessionContext("pi"), true);
  assert.equal(supportsSessionContext("prime"), true);
  assert.equal(supportsSessionContext("omp"), true);
  assert.equal(supportsSessionContext("agy"), false);
  assert.equal(supportsSessionContext("cursor"), false);
  assert.equal(supportsSessionContext("opencode"), false);
});

test("sessionContextArgs passes the context file contents as one argument", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-resume-context-"));
  const file = path.join(dir, "AGENTS.md");
  const body = "# Task context\n\nline two\n";
  fs.writeFileSync(file, body, "utf8");
  try {
    assert.deepEqual(sessionContextArgs("codex", file), ["-c", `developer_instructions=${body}`]);
    assert.deepEqual(sessionContextArgs("claude", file), ["--append-system-prompt", body]);
    assert.deepEqual(sessionContextArgs("pi", file), ["--append-system-prompt", body]);
    assert.deepEqual(sessionContextArgs("prime", file), ["--append-system-prompt", body]);
    assert.deepEqual(sessionContextArgs("omp", file), ["--append-system-prompt", body]);
    assert.deepEqual(sessionContextArgs("agy", file), []);
    // A missing file drops the flag instead of launching an agent with `$(cat ...)`.
    assert.deepEqual(sessionContextArgs("claude", path.join(dir, "missing.md")), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("buildResumeArgv keeps the provider's flags and adds context", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-resume-context-"));
  const file = path.join(dir, "AGENTS.md");
  fs.writeFileSync(file, "# Task context", "utf8");
  try {
    const session = { id: "sess-1", provider: "claude", projectPath: "/work/app", title: "t", updatedAt: 1 };
    assert.deepEqual(buildResumeArgv(session), ["claude", "--resume", "sess-1"]);
    assert.deepEqual(buildResumeArgv(session, file), [
      "claude",
      "--resume",
      "sess-1",
      "--append-system-prompt",
      "# Task context"
    ]);
    const codexSession = { id: "sess-2", provider: "codex", projectPath: "/work/app", title: "t", updatedAt: 1 };
    assert.deepEqual(buildResumeArgv(codexSession, file), [
      "codex",
      "resume",
      "--cd",
      "/work/app",
      "sess-2",
      "-c",
      "developer_instructions=# Task context"
    ]);
    // A context file is never rendered as a shell substitution any more.
    assert.equal(
      buildResumeCommand(session, file, "posix"),
      "claude --resume 'sess-1' --append-system-prompt '# Task context'"
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
