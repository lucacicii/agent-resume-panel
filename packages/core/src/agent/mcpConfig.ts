import * as path from "node:path";
import * as fs from "node:fs";

export interface McpServerCommand {
  command: string;
  args: string[];
}

function findCompiledCli(): string | null {
  const candidates = [
    path.join(__dirname, "..", "mcp", "cli.js"),
    path.join(__dirname, "mcp", "cli.js"),
    path.join(process.cwd(), "packages", "core", "dist", "mcp", "cli.js")
  ];
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    } catch {
      // ignore
    }
  }
  return null;
}

export function resolveMcpServerCommand(
  commandOverride?: string,
  argsOverride?: string[]
): McpServerCommand {
  if (commandOverride) {
    return { command: commandOverride, args: argsOverride || [] };
  }

  const cliPath = findCompiledCli();
  if (cliPath) {
    return { command: process.execPath, args: [cliPath] };
  }

  return { command: "npx", args: ["@agent-resume/core", "--mcp"] };
}
