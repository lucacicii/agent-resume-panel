import { readFileSync, writeFileSync } from "node:fs";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { buildArpmShim, installArpmShim, isManagedArpmShim } from "./arpmInstall";

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
});
