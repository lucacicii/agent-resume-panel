import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import { HerdrAppClient } from "../../out/herdr/herdrApp.js";
import {
  deriveSpaceNameFromFolder,
  isHerdrNameConflictError,
  resolveUniqueHerdrTerminalName,
  sanitizeHerdrTerminalName
} from "../../out/herdr/naming.js";

test("resolveUniqueHerdrTerminalName deduplicates live names and respects 32-char limit", () => {
  assert.equal(resolveUniqueHerdrTerminalName("pi-new", []), "pi-new");
  assert.equal(resolveUniqueHerdrTerminalName("pi-new", ["pi-new"]), "pi-new-2");
  assert.equal(resolveUniqueHerdrTerminalName("pi-new", ["PI-NEW", "pi-new-2"]), "pi-new-3");

  const longRaw = "very-long-provider-session-name-exceeding-limit";
  const uniqueLong = resolveUniqueHerdrTerminalName(longRaw, [sanitizeHerdrTerminalName(longRaw)]);
  assert.ok(uniqueLong);
  assert.ok(uniqueLong.length <= 32);
  assert.ok(uniqueLong.endsWith("-2"));
});

test("deriveSpaceNameFromFolder extracts folder basename cleanly", () => {
  assert.equal(deriveSpaceNameFromFolder("/Users/lucas/wz/GitHub"), "GitHub");
  assert.equal(deriveSpaceNameFromFolder("/Users/lucas/wz/GitHub///"), "GitHub");
  assert.equal(deriveSpaceNameFromFolder("/"), "");
  assert.equal(deriveSpaceNameFromFolder(""), "");
  assert.equal(deriveSpaceNameFromFolder(undefined), "");
});

test("isHerdrNameConflictError matches terminal name conflict messages", () => {
  assert.equal(isHerdrNameConflictError(new Error("name 'pi-new' is already in use")), true);
  assert.equal(isHerdrNameConflictError(new Error("duplicate name")), true);
  assert.equal(isHerdrNameConflictError(new Error("daemon offline")), false);
});

test("HerdrAppClient.ensureSpaceForTerminal creates missing space and reuses existing space", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-app-test-"));
  const projDir = path.join(tmpDir, "my-project");
  fs.mkdirSync(projDir, { recursive: true });
  const realProjDir = fs.realpathSync(projDir);

  const logFile = path.join(tmpDir, "calls.log");
  const stateFile = path.join(tmpDir, "state");
  const fakeScript = path.join(tmpDir, "herdr-app");

  fs.writeFileSync(
    fakeScript,
    `#!/bin/sh
LOG="${logFile}"
STATE="${stateFile}"
printf '%s\\n' "$*" >> "$LOG"
cmd="$1"
if [ "$cmd" = "ls" ]; then
  if [ -f "$STATE" ]; then
    echo '{"spaces":[{"id":"sp1","name":"my-project","folder":"${realProjDir}","machine":null,"active":true,"tabs":[{"id":"tb1","terminals":[{"terminal":"t1"}]}]}]}'
  else
    echo '{"spaces":[]}'
  fi
  exit 0
fi
if [ "$cmd" = "do" ]; then
  sub="$2"
  if [ "$sub" = "space.new" ]; then
    echo '{"space":"sp1","tab":"tb_shell"}'
    exit 0
  fi
  if [ "$sub" = "terminal.keep" ]; then
    touch "$STATE"
    echo '{}'
    exit 0
  fi
  echo '{}'
  exit 0
fi
`,
    { mode: 0o755 }
  );

  try {
    const client = new HerdrAppClient(fakeScript);
    const first = await client.ensureSpaceForTerminal("", projDir, "t1");
    assert.deepEqual(first, { spaceId: "sp1", created: true });

    const second = await client.ensureSpaceForTerminal("", projDir, "t2");
    assert.deepEqual(second, { spaceId: "sp1", created: false });

    const logContent = fs.readFileSync(logFile, "utf8");
    const spaceNewMatches = logContent.match(/do space\.new/g) ?? [];
    assert.equal(spaceNewMatches.length, 1);
    assert.ok(logContent.includes("--name my-project"));
    assert.ok(logContent.includes("do tab.close --confirmed true --id tb_shell"));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
