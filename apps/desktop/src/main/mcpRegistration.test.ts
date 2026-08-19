import { existsSync } from "node:fs";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import {
  EXTERNAL_MCP_SERVICE_ID,
  buildCliRegistrationArgs,
  createExternalMcpLaunchConfig,
  isLegacyAgentResumeLaunch,
  manualMcpConfig,
  migrateTomlAgentResumeSection,
  parseMcpJsonConfig,
  readMcpJsonConfig,
  resolveExecutableOnPath,
  resolveExternalMcpCliPath
} from "./mcpRegistration";

describe("desktop external MCP registration", () => {
  it("builds a headless Node-mode launch descriptor (no Dock GUI Electron entry)", () => {
    const cliPath = "/Users/test/packages/core/dist/mcp/cli.js";
    const launch = createExternalMcpLaunchConfig({
      executablePath: "/Applications/Agent Resume.app/Contents/MacOS/Agent Resume",
      cliPath,
      panelHome: "/Users/test/.agent-resume-panel"
    });

    expect(launch).toEqual({
      command: "/Applications/Agent Resume.app/Contents/MacOS/Agent Resume",
      args: [cliPath],
      env: {
        ELECTRON_RUN_AS_NODE: "1",
        AGENT_RESUME_PANEL_HOME: "/Users/test/.agent-resume-panel"
      }
    });
    expect(launch.args).not.toContain("--agent-resume-mcp");
    expect(JSON.parse(manualMcpConfig(launch)).mcpServers[EXTERNAL_MCP_SERVICE_ID]).toEqual({
      command: launch.command,
      args: launch.args,
      env: launch.env
    });
  });

  it("orders Claude environment flags after the MCP server name", () => {
    const launch = createExternalMcpLaunchConfig({
      executablePath: "/Applications/Agent Resume.app/Contents/MacOS/Agent Resume",
      cliPath: "/app/mcp/cli.js",
      panelHome: "/Users/test/.agent-resume-panel"
    });

    expect(buildCliRegistrationArgs("claude", launch)).toEqual([
      "mcp",
      "add",
      "--scope",
      "user",
      "agent-resume",
      "-e",
      "ELECTRON_RUN_AS_NODE=1",
      "-e",
      "AGENT_RESUME_PANEL_HOME=/Users/test/.agent-resume-panel",
      "--",
      launch.command,
      ...launch.args
    ]);
    expect(buildCliRegistrationArgs("codex", launch).slice(0, 4)).toEqual([
      "mcp",
      "add",
      "--env",
      "ELECTRON_RUN_AS_NODE=1"
    ]);
  });

  it("resolves an executable from the inherited PATH even when the shell PATH is minimal", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agent-resume-executable-"));
    const executable = path.join(directory, "codex-test");
    try {
      await fs.writeFile(executable, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
      expect(await resolveExecutableOnPath("codex-test", directory)).toBe(executable);
      expect(await resolveExecutableOnPath("missing-codex", directory)).toBeUndefined();
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });

  it("resolves the monorepo MCP CLI for unpackaged Desktop", () => {
    const appPath = path.resolve(__dirname, "../..");
    const cliPath = resolveExternalMcpCliPath({
      isPackaged: false,
      resourcesPath: "/unused",
      appPath
    });
    expect(cliPath.endsWith(`${path.sep}mcp${path.sep}cli.js`)).toBe(true);
    expect(existsSync(cliPath)).toBe(true);
  });

  it("detects legacy GUI Electron MCP launches", () => {
    expect(
      isLegacyAgentResumeLaunch({
        command: "/path/Electron",
        args: ["/apps/desktop", "--agent-resume-mcp", "agent-resume"],
        env: { AGENT_RESUME_PANEL_HOME: "/home/.agent-resume-panel" }
      })
    ).toBe(true);

    expect(
      isLegacyAgentResumeLaunch({
        command: "/path/Electron",
        args: ["/packages/core/dist/mcp/cli.js"],
        env: {
          ELECTRON_RUN_AS_NODE: "1",
          AGENT_RESUME_PANEL_HOME: "/home/.agent-resume-panel"
        }
      })
    ).toBe(false);
  });

  it("parses valid MCP JSON while keeping malformed non-empty JSON visible", () => {
    expect(parseMcpJsonConfig('{"mcpServers":{}}')).toEqual({ mcpServers: {} });
    expect(() => parseMcpJsonConfig("[]")).toThrow("Configuration root must be an object.");
    expect(() => parseMcpJsonConfig("{")).toThrow();
  });

  it("repairs an empty MCP JSON file atomically", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agent-resume-mcp-json-"));
    const configPath = path.join(directory, "mcp.json");
    try {
      await fs.writeFile(configPath, " \n", "utf8");
      expect(await readMcpJsonConfig(configPath)).toEqual({});
      expect(JSON.parse(await fs.readFile(configPath, "utf8"))).toEqual({});
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });

  it("migrates Codex/Grok TOML agent-resume sections to headless CLI", () => {
    const launch = createExternalMcpLaunchConfig({
      executablePath: "/Applications/Agent Resume.app/Contents/MacOS/Agent Resume",
      cliPath: "/app/node_modules/@agent-resume/core/dist/mcp/cli.js",
      panelHome: "/Users/test/.agent-resume-panel"
    });

    const input = `
[mcp_servers.other]
command = "keep-me"

[mcp_servers.agent-resume]
command = "/old/Electron"
args = [
    "/apps/desktop",
    "--agent-resume-mcp",
    "agent-resume",
]
enabled = true

[mcp_servers.agent-resume.env]
AGENT_RESUME_PANEL_HOME = "/Users/test/.agent-resume-panel"

[mcp_servers.agent-resume.tools.note_list]
approval_mode = "approve"
`;

    const { content, changed } = migrateTomlAgentResumeSection(input, launch);
    expect(changed).toBe(true);
    expect(content).toContain('command = "/Applications/Agent Resume.app/Contents/MacOS/Agent Resume"');
    expect(content).toContain('args = ["/app/node_modules/@agent-resume/core/dist/mcp/cli.js"]');
    expect(content).toContain('ELECTRON_RUN_AS_NODE = "1"');
    expect(content).not.toContain("--agent-resume-mcp");
    expect(content).toContain("enabled = true");
    expect(content).toContain("[mcp_servers.agent-resume.tools.note_list]");
    expect(content).toContain('command = "keep-me"');

    const second = migrateTomlAgentResumeSection(content, launch);
    expect(second.changed).toBe(false);
  });
});
