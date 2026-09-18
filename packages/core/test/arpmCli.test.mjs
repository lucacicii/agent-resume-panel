import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DEFAULT_SETTINGS, saveSettings } from "../dist/index.js";
import { planArpmRun, runArpmCli } from "../dist/settings/arpmCli.js";

async function withPanelHome(run) {
  const panelHome = await fs.mkdtemp(path.join(os.tmpdir(), "agent-resume-arpm-"));
  const previous = process.env.AGENT_RESUME_PANEL_HOME;
  process.env.AGENT_RESUME_PANEL_HOME = panelHome;
  try {
    await saveSettings(
      {
        ...structuredClone(DEFAULT_SETTINGS),
        panelHome,
        workbench: {
          composerMentions: [
            {
              id: "anfeng",
              cwd: path.join(panelHome, "c"),
              roots: [{ path: path.join(panelHome, "a"), role: "reference" }]
            }
          ]
        }
      },
      panelHome
    );
    return await run(panelHome);
  } finally {
    if (previous === undefined) delete process.env.AGENT_RESUME_PANEL_HOME;
    else process.env.AGENT_RESUME_PANEL_HOME = previous;
    await fs.rm(panelHome, { recursive: true, force: true });
  }
}

function captureStdio(fn) {
  const stdout = [];
  const stderr = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (...args) => {
    stdout.push(args.map(String).join(" "));
  };
  console.error = (...args) => {
    stderr.push(args.map(String).join(" "));
  };
  return fn().finally(() => {
    console.log = originalLog;
    console.error = originalError;
  }).then((code) => ({ code, stdout: stdout.join("\n"), stderr: stderr.join("\n") }));
}

test("arpm list / prompt / go print the configured workspace pack", async () => {
  await withPanelHome(async (panelHome) => {
    const listed = await captureStdio(() => runArpmCli(["list"]));
    assert.equal(listed.code, 0);
    assert.match(listed.stdout, /anfeng/);
    assert.match(listed.stdout, new RegExp(path.join(panelHome, "c")));

    const prompted = await captureStdio(() => runArpmCli(["prompt", "anfeng"]));
    assert.equal(prompted.code, 0);
    assert.match(prompted.stdout, /\[Workspace anfeng\]/);
    assert.match(prompted.stdout, /Reference \(read only\):/);

    const gone = await captureStdio(() => runArpmCli(["go", "anfeng"]));
    assert.equal(gone.code, 0);
    assert.match(gone.stdout, /\[Workspace anfeng\]/);
    assert.match(gone.stdout, /cd '/);

    const printed = await captureStdio(() => runArpmCli(["go", "anfeng", "--print-cwd"]));
    assert.equal(printed.code, 0);
    assert.equal(printed.stdout.trim(), path.join(panelHome, "c"));

    const missing = await captureStdio(() => runArpmCli(["prompt", "nope"]));
    assert.equal(missing.code, 1);
    assert.match(missing.stderr, /Unknown mention/);
  });
});

test("planArpmRun plans commands with optional task context injection", async () => {
  await withPanelHome(async (panelHome) => {
    const settings = structuredClone(DEFAULT_SETTINGS);

    // Standard run with default provider (codex).
    const standard = await planArpmRun({
      args: [],
      cwd: "/repo/my-app",
      panelHome,
      settings
    });
    assert.equal(standard.command, "codex --cd '/repo/my-app'");
    assert.equal(standard.warning, undefined);

    // Explicit provider (claude).
    const claudeRun = await planArpmRun({
      args: ["--provider", "claude"],
      cwd: "/repo/my-app",
      panelHome,
      settings
    });
    assert.equal(claudeRun.command, "claude");

    // Missing task context file fails fast.
    await assert.rejects(
      () =>
        planArpmRun({
          args: ["--note", "wi-missing"],
          cwd: "/repo/my-app",
          panelHome,
          settings
        }),
      /No agent context for task wi-missing yet/
    );

    // Seed workspace context file.
    const wsDir = path.join(panelHome, ".desktop", "workspaces", "wi-1");
    await fs.mkdir(wsDir, { recursive: true });
    const agentsFile = path.join(wsDir, "AGENTS.md");
    await fs.writeFile(agentsFile, "# Task context", "utf8");

    // Claude with task context file injected.
    const claudeWithNote = await planArpmRun({
      args: ["--provider", "claude", "--note", "wi-1"],
      cwd: "/repo/my-app",
      panelHome,
      settings
    });
    assert.equal(
      claudeWithNote.command,
      `claude --append-system-prompt "$(cat '${agentsFile}')"`
    );
    assert.equal(claudeWithNote.warning, undefined);

    // Codex with task context file injected.
    const codexWithNote = await planArpmRun({
      args: ["--provider", "codex", "--note", "wi-1"],
      cwd: "/repo/my-app",
      panelHome,
      settings
    });
    assert.equal(
      codexWithNote.command,
      `codex --cd '/repo/my-app' -c "developer_instructions=$(cat '${agentsFile}')"`
    );

    // Unsupported provider (agy) warns and drops the context flag.
    const agyWithNote = await planArpmRun({
      args: ["--provider", "agy", "--note", "wi-1"],
      cwd: "/repo/my-app",
      panelHome,
      settings
    });
    assert.equal(agyWithNote.command, "agy");
    assert.match(agyWithNote.warning || "", /agy has no session instruction flag/);
  });
});

