import { readFileSync, writeFileSync } from "node:fs";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ARPM_PROFILE_BEGIN,
  ARPM_RC_BEGIN,
  buildArpmCmdShim,
  buildArpmShim,
  installArpmShell,
  installArpmShim,
  isManagedArpmShim
} from "./arpmInstall";

describe("arpm shim install", () => {
  it("writes a managed wrapper and skips a foreign binary", async () => {
    const binDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-resume-arpm-"));
    try {
      const first = installArpmShim({
        execPath: "/Applications/Agent Resume.app/Contents/MacOS/Agent Resume",
        cliPath: "/app/settings/arpm.js",
        panelHome: "/Users/test/.agent-resume-panel",
        binDir
      });
      expect(first.written).toBe(true);
      const content = readFileSync(first.path, "utf8");
      expect(isManagedArpmShim(content)).toBe(true);
      expect(content).toContain("ELECTRON_RUN_AS_NODE=1");
      expect(content).toContain("AGENT_RESUME_PANEL_HOME='/Users/test/.agent-resume-panel'");
      expect(content).toContain("exec '/Applications/Agent Resume.app/Contents/MacOS/Agent Resume' '/app/settings/arpm.js' \"$@\"");

      const second = installArpmShim({
        execPath: "/Applications/Agent Resume.app/Contents/MacOS/Agent Resume",
        cliPath: "/app/settings/arpm.js",
        panelHome: "/Users/test/.agent-resume-panel",
        binDir
      });
      expect(second.written).toBe(false);

      const foreignDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-resume-arpm-foreign-"));
      const foreign = path.join(foreignDir, "arpm");
      writeFileSync(foreign, "#!/bin/sh\necho other\n", { mode: 0o755 });
      const skipped = installArpmShim({
        execPath: "/app/Agent Resume",
        cliPath: "/app/arpm.js",
        panelHome: "/tmp/home",
        binDir: foreignDir
      });
      expect(skipped.written).toBe(false);
      expect(skipped.skipped).toMatch(/not managed/);
      expect(readFileSync(foreign, "utf8")).toContain("echo other");
    } finally {
      await fs.rm(binDir, { recursive: true, force: true });
    }
  });

  it("rewrites the shim when the app path changes", () => {
    const script = buildArpmShim({
      execPath: "/old/Agent Resume",
      cliPath: "/old/arpm.js",
      panelHome: "/old/home"
    });
    expect(isManagedArpmShim(script)).toBe(true);
  });

  it("installs a shell function that cds on arpm go", async () => {
    const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-resume-arpm-home-"));
    const panelHome = await fs.mkdtemp(path.join(os.tmpdir(), "agent-resume-arpm-panel-"));
    try {
      await fs.writeFile(path.join(homeDir, ".zshrc"), "# existing\n", "utf8");
      const installed = installArpmShell({ panelHome, homeDir, platform: "darwin" });
      const hook = readFileSync(installed.hookPath, "utf8");
      expect(hook).toContain("builtin cd");
      expect(hook).toContain('command arpm go "$2" --print-cwd');
      expect(hook).toContain("[ -z \"${2:-}\" ]");
      const zshrc = readFileSync(path.join(homeDir, ".zshrc"), "utf8");
      expect(zshrc).toContain("# existing");
      expect(zshrc).toContain(ARPM_RC_BEGIN);
      expect(zshrc).toContain(installed.hookPath);
      const bashrc = readFileSync(path.join(homeDir, ".bashrc"), "utf8");
      expect(bashrc).toContain(ARPM_RC_BEGIN);
      const again = installArpmShell({ panelHome, homeDir, platform: "darwin" });
      expect(again.rcPaths).toEqual([]);
    } finally {
      await fs.rm(homeDir, { recursive: true, force: true });
      await fs.rm(panelHome, { recursive: true, force: true });
    }
  });

  it("writes arpm.cmd and a PowerShell profile hook on Windows", async () => {
    const binDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-resume-arpm-win-"));
    const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-resume-arpm-win-home-"));
    const panelHome = await fs.mkdtemp(path.join(os.tmpdir(), "agent-resume-arpm-win-panel-"));
    try {
      const installed = installArpmShim({
        execPath: "C:\\Program Files\\Agent Resume\\Agent Resume.exe",
        cliPath: "C:\\Program Files\\Agent Resume\\resources\\app.asar\\arpm.js",
        panelHome: "C:\\Users\\test\\.agent-resume-panel",
        binDir,
        platform: "win32"
      });
      expect(installed.path.endsWith("arpm.cmd")).toBe(true);
      const content = readFileSync(installed.path, "utf8");
      expect(isManagedArpmShim(content)).toBe(true);
      expect(content).toContain("ELECTRON_RUN_AS_NODE=1");
      expect(content).toContain('set "AGENT_RESUME_PANEL_HOME=C:\\Users\\test\\.agent-resume-panel"');
      // Paths with spaces stay quoted; `%*` forwards the user's arguments.
      expect(content).toContain('"C:\\Program Files\\Agent Resume\\Agent Resume.exe"');
      expect(content).toContain("%*");

      const shell = installArpmShell({ panelHome, homeDir, platform: "win32" });
      expect(shell.hookPath.endsWith("arpm.ps1")).toBe(true);
      const hook = readFileSync(shell.hookPath, "utf8");
      expect(hook).toContain("Set-Location -LiteralPath $target");
      // The hook names the shim by absolute path, so it works in a session
      // whose PATH does not yet include the shim directory.
      expect(hook).toMatch(/& '[^']*[\\/]arpm\.cmd' go \$arguments\[1\] --print-cwd/);
      // Both PowerShell hosts get a profile entry.
      expect(shell.rcPaths).toHaveLength(2);
      for (const profilePath of shell.rcPaths) {
        const profile = readFileSync(profilePath, "utf8");
        expect(profile).toContain(ARPM_PROFILE_BEGIN);
        expect(profile).toContain("$env:Path = ");
      }
    } finally {
      await fs.rm(binDir, { recursive: true, force: true });
      await fs.rm(homeDir, { recursive: true, force: true });
      await fs.rm(panelHome, { recursive: true, force: true });
    }
  });

  it("keeps the batch shim free of POSIX quoting", () => {
    const shim = buildArpmCmdShim({
      execPath: "C:\\Apps\\Agent Resume.exe",
      cliPath: "C:\\Apps\\arpm.js",
      panelHome: "C:\\Users\\me\\panel"
    });
    expect(shim).not.toContain("#!/bin/sh");
    expect(shim).not.toContain("'");
    expect(shim.startsWith("@echo off")).toBe(true);
  });
});
