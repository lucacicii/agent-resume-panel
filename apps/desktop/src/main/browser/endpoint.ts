import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { browserMcpEndpointPath, resolvePanelHome } from "@agent-resume/core";
import type { BrowserMcpServerHandle } from "./mcpServer";

export type BrowserMcpEndpointFile = {
  url: string;
  token: string;
  port: number;
  pid: number;
  updatedAt: number;
  version: string;
};

/**
 * Publish the live loopback browser MCP handle so external stdio proxies
 * (CLI / TUI MCP clients) can discover port + bearer token.
 */
export async function publishBrowserMcpEndpoint(
  handle: BrowserMcpServerHandle,
  panelHome: string
): Promise<string> {
  const home = resolvePanelHome(panelHome);
  const target = browserMcpEndpointPath(home);
  await mkdir(path.dirname(target), { recursive: true });
  const payload: BrowserMcpEndpointFile = {
    url: handle.url,
    token: handle.token,
    port: handle.port,
    pid: process.pid,
    updatedAt: Date.now(),
    version: "0.1.0"
  };
  const temporary = `${target}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await rename(temporary, target);
  return target;
}

export async function clearBrowserMcpEndpoint(panelHome: string): Promise<void> {
  const home = resolvePanelHome(panelHome);
  const target = browserMcpEndpointPath(home);
  try {
    await unlink(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
