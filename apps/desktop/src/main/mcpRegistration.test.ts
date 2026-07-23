import { describe, expect, it } from "vitest";
import {
  EXTERNAL_MCP_SERVICE_ID,
  createExternalMcpLaunchConfig,
  manualMcpConfig
} from "./mcpRegistration";
import { parseMcpRunnerArgs } from "./mcpRunner";

describe("desktop external MCP registration", () => {
  it("builds a stable stdio launch descriptor for the Desktop executable", () => {
    const launch = createExternalMcpLaunchConfig({
      executablePath: "/Applications/Agent Resume.app/Contents/MacOS/Agent Resume",
      panelHome: "/Users/test/.agent-resume-panel"
    });

    expect(launch).toEqual({
      command: "/Applications/Agent Resume.app/Contents/MacOS/Agent Resume",
      args: ["--agent-resume-mcp", EXTERNAL_MCP_SERVICE_ID],
      env: { AGENT_RESUME_PANEL_HOME: "/Users/test/.agent-resume-panel" }
    });
    expect(JSON.parse(manualMcpConfig(launch)).mcpServers[EXTERNAL_MCP_SERVICE_ID]).toEqual({
      command: launch.command,
      args: launch.args,
      env: launch.env
    });
  });

  it("recognizes MCP runner mode before Electron creates a window", () => {
    expect(parseMcpRunnerArgs(["electron", "main.js"])).toBeNull();
    expect(parseMcpRunnerArgs(["electron", "main.js", "--agent-resume-mcp", EXTERNAL_MCP_SERVICE_ID])).toMatchObject({
      serviceId: EXTERNAL_MCP_SERVICE_ID
    });
  });
});
