import { runStdioServer } from "./server";

async function main(): Promise<void> {
  const panelHome = process.env.AGENT_RESUME_PANEL_HOME || undefined;
  await runStdioServer(panelHome);
}

main().catch((error) => {
  console.error("MCP server failed to start:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
