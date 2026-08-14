import { runBrowserMcpStdioProxy } from "./browserProxy";

async function main(): Promise<void> {
  const panelHome = process.env.AGENT_RESUME_PANEL_HOME || undefined;
  await runBrowserMcpStdioProxy(panelHome);
}

main().catch((error) => {
  console.error(
    "agent-resume-browser MCP proxy failed:",
    error instanceof Error ? error.message : String(error)
  );
  process.exit(1);
});
