#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { resolveMcpPaths } from "./config.js";
import {
  MCP_SERVER_NAME,
  MCP_SERVER_VERSION,
  createAgentResumeMcpServer
} from "./server.js";

function parseCliArgs(argv: string[]): { panelHome?: string; help: boolean; version: boolean } {
  let panelHome: string | undefined;
  let help = false;
  let version = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") {
      help = true;
    } else if (arg === "-v" || arg === "--version") {
      version = true;
    } else if (arg === "--panel-home" && i + 1 < argv.length) {
      panelHome = argv[++i];
    } else if (arg.startsWith("--panel-home=")) {
      panelHome = arg.slice("--panel-home=".length);
    }
  }

  return { panelHome, help, version };
}

function printHelp(): void {
  process.stderr.write(
    `${MCP_SERVER_NAME} v${MCP_SERVER_VERSION} — MCP stdio server for Agent Resume Panel\n\n` +
      `Usage:\n` +
      `  agent-resume-mcp [--panel-home <path>]\n\n` +
      `Options:\n` +
      `  --panel-home <path>  Override panel home directory (default ~/.agent-resume-panel)\n` +
      `  -h, --help           Show this help message\n` +
      `  -v, --version        Show version\n`
  );
}

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  if (args.version) {
    process.stdout.write(`${MCP_SERVER_VERSION}\n`);
    return;
  }

  const paths = resolveMcpPaths(args.panelHome);
  const server = createAgentResumeMcpServer(paths);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  process.stderr.write(`[${MCP_SERVER_NAME}] fatal: ${message}\n`);
  process.exit(1);
});
