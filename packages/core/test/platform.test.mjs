import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
  executableCandidates,
  pathextEntries,
  requiresWindowsShell,
  resolveExecutable,
  spawnSpecFor
} from "../dist/executable.js";
import {
  avoidWindowsReservedName,
  expandEnvVars,
  isPathInside,
  isWindowsReservedName,
  normalizePathForCompare,
  quoteCmd,
  quotePosix,
  quotePowerShell,
  samePath,
  shellKindForExecutable
} from "../dist/platform.js";
import { expandHome } from "../dist/pathUtils.js";

const WIN = "win32";
const POSIX = "linux";

test("PATHEXT decides which names a bare command can resolve to", () => {
  const env = { PATHEXT: ".COM;.EXE;.BAT;.CMD" };
  assert.deepEqual(executableCandidates("codex", env, WIN).names, [
    "codex.com",
    "codex.exe",
    "codex.bat",
    "codex.cmd"
  ]);
  assert.deepEqual(executableCandidates("codex.cmd", env, WIN).names, ["codex.cmd"]);
  assert.deepEqual(pathextEntries({}), [".com", ".exe", ".bat", ".cmd"]);
});

test("resolveExecutable prefers .exe over a .cmd shim and honours explicit extensions", () => {
  const present = new Set(["C:\\tools\\code.cmd", "C:\\bin\\codex.exe"]);
  const check = (file) => present.has(file);
  assert.equal(
    resolveExecutable("code", "C:\\tools", { platform: WIN, env: { PATHEXT: ".EXE;.CMD" }, isExecutable: check }),
    "C:\\tools\\code.cmd"
  );
  assert.equal(
    resolveExecutable("codex", "C:\\bin", { platform: WIN, env: { PATHEXT: ".EXE;.CMD" }, isExecutable: check }),
    "C:\\bin\\codex.exe"
  );
  assert.equal(
    resolveExecutable("code.cmd", "C:\\tools", { platform: WIN, isExecutable: check }),
    "C:\\tools\\code.cmd"
  );
  assert.equal(
    resolveExecutable("nope", "C:\\tools", { platform: WIN, isExecutable: check }),
    null
  );
});

test("spawnSpecFor routes .cmd/.bat through cmd.exe and leaves real binaries alone", () => {
  const shim = spawnSpecFor("C:\\Program Files\\nodejs\\npx.cmd", ["-y", "pkg"], WIN);
  assert.equal(shim.file, "cmd.exe");
  assert.equal(shim.shell, false);
  assert.equal(shim.args[0], "/d");
  assert.equal(shim.args[1], "/s");
  assert.equal(shim.args[2], "/c");
  // `/s` strips exactly the outer pair; the leading quoted path is what makes
  // cmd keep the space in "Program Files".
  assert.equal(shim.args[3], '""C:\\Program Files\\nodejs\\npx.cmd" -y pkg"');

  const binary = spawnSpecFor("C:\\bin\\codex.exe", ["a b"], WIN);
  assert.deepEqual(binary, { file: "C:\\bin\\codex.exe", args: ["a b"], shell: false });

  assert.equal(requiresWindowsShell("C:\\bin\\x.BAT", WIN), true);
  assert.equal(requiresWindowsShell("/usr/bin/x", POSIX), false);
});

test("quoting dialects differ in the way each shell expects", () => {
  assert.equal(quotePosix("it's"), `'it'\\''s'`);
  assert.equal(quotePowerShell("it's"), "'it''s'");
  assert.equal(quoteCmd("C:\\Program Files\\a"), '"C:\\Program Files\\a"');
  assert.equal(quoteCmd("C:\\plain"), "C:\\plain");
  assert.equal(shellKindForExecutable("C:\\Windows\\System32\\cmd.exe", WIN), "cmd");
  assert.equal(shellKindForExecutable("C:\\Program Files\\PowerShell\\7\\pwsh.exe", WIN), "powershell");
  assert.equal(shellKindForExecutable("C:\\Program Files\\Git\\bin\\bash.exe", WIN), "posix");
});

test("path identity is case-insensitive on win32 and separator-agnostic", () => {
  assert.equal(normalizePathForCompare("C:\\Repo\\src\\", WIN), "c:\\repo\\src");
  assert.equal(normalizePathForCompare("\\\\?\\C:\\Repo", WIN), "c:\\repo");
  assert.equal(normalizePathForCompare("C:\\", WIN), "c:\\");
  assert.equal(samePath("C:\\Repo", "c:/repo/", WIN), true);
  assert.equal(samePath("/Repo", "/repo", POSIX), false);

  assert.equal(isPathInside("C:\\repo", "c:/repo/src/a.ts", WIN), true);
  assert.equal(isPathInside("C:\\repo", "C:\\repo-2\\a.ts", WIN), false);
  assert.equal(isPathInside("C:\\repo", "C:\\repo", WIN), true);
  assert.equal(isPathInside("/repo", "/repo/src", POSIX), true);
  assert.equal(isPathInside("/repo", "/repo-2", POSIX), false);
});

test("env and home expansion understands Windows forms", () => {
  const env = { USERPROFILE: "C:\\Users\\alice", APPDATA: "C:\\Users\\alice\\AppData\\Roaming" };
  assert.equal(expandEnvVars("%APPDATA%\\Cursor", env, WIN), "C:\\Users\\alice\\AppData\\Roaming\\Cursor");
  assert.equal(expandEnvVars("%NOPE%\\x", env, WIN), "%NOPE%\\x");
  assert.equal(expandEnvVars("${HOME}/x", { HOME: "/home/a" }, POSIX), "/home/a/x");
});

test("reserved device names are recognised and repaired", () => {
  for (const name of ["CON", "con.md", "NUL", "COM1", "lpt9.txt"]) {
    assert.equal(isWindowsReservedName(name), true, name);
  }
  for (const name of ["console", "COM10", "notes.md"]) {
    assert.equal(isWindowsReservedName(name), false, name);
  }
  assert.equal(avoidWindowsReservedName("CON.md"), "CON-.md");
  assert.equal(avoidWindowsReservedName("notes.md"), "notes.md");
});

test("expandHome accepts backslash tilde and Windows env vars", () => {
  const home = process.env.HOME || process.env.USERPROFILE || "";
  if (path.sep === "/") {
    assert.equal(expandHome("~\\x"), path.join(home, "x"));
  }
});
