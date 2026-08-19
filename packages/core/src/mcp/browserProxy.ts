import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { browserMcpEndpointPath, resolvePanelHome } from "../panelHome";

export const BROWSER_MCP_SERVICE_ID = "agent-resume-browser";

export type BrowserMcpEndpoint = {
  url: string;
  token: string;
  port: number;
  pid: number;
  updatedAt: number;
  version?: string;
};

type JsonRpcId = string | number | null;

type JsonRpcMessage = {
  jsonrpc?: string;
  id?: JsonRpcId;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: unknown;
};

function isNotification(message: JsonRpcMessage): boolean {
  return message.id === undefined;
}

async function readEndpoint(panelHome: string): Promise<BrowserMcpEndpoint> {
  const path = browserMcpEndpointPath(panelHome);
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(
        "Agent Resume Desktop browser MCP is not running. Open Desktop (browser pane enabled) and try again."
      );
    }
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Invalid browser MCP endpoint file: ${path}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Invalid browser MCP endpoint file: ${path}`);
  }
  const row = parsed as Record<string, unknown>;
  const url = typeof row.url === "string" ? row.url : "";
  const token = typeof row.token === "string" ? row.token : "";
  const port = typeof row.port === "number" ? row.port : Number(row.port);
  const pid = typeof row.pid === "number" ? row.pid : Number(row.pid);
  if (!url || !token || !Number.isFinite(port)) {
    throw new Error(`Incomplete browser MCP endpoint file: ${path}`);
  }
  return {
    url,
    token,
    port,
    pid: Number.isFinite(pid) ? pid : 0,
    updatedAt: typeof row.updatedAt === "string" || typeof row.updatedAt === "number" ? Number(row.updatedAt) : 0,
    version: typeof row.version === "string" ? row.version : undefined
  };
}

function projectPathFromEnv(): string {
  const candidates = [
    process.env.AGENT_RESUME_PROJECT_PATH,
    process.env.AGENT_RESUME_CWD,
    process.env.PWD,
    process.cwd()
  ];
  for (const value of candidates) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "unknown";
}

function clientNameFromEnv(): string {
  const candidates = [
    process.env.AGENT_RESUME_BROWSER_CLIENT,
    process.env.CLAUDE_CODE_ENTRYPOINT,
    process.env.TERM_PROGRAM,
    "external-mcp"
  ];
  for (const value of candidates) {
    if (typeof value === "string" && value.trim()) return value.trim().slice(0, 64);
  }
  return "external-mcp";
}

async function forwardHttp(
  endpoint: BrowserMcpEndpoint,
  body: unknown,
  headers: Record<string, string>
): Promise<{ status: number; text: string; json: unknown | null }> {
  const response = await fetch(endpoint.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${endpoint.token}`,
      ...headers
    },
    body: JSON.stringify(body)
  });
  const text = await response.text();
  let json: unknown | null = null;
  if (text.trim()) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }
  return { status: response.status, text, json };
}

function writeStdout(message: unknown): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function errorResponse(id: JsonRpcId, code: number, message: string): JsonRpcMessage {
  return {
    jsonrpc: "2.0",
    id,
    error: { code, message }
  };
}

/**
 * Headless stdio MCP proxy: reads JSON-RPC lines from stdin, forwards to Desktop's
 * loopback browser MCP HTTP server, writes responses to stdout.
 */
export async function runBrowserMcpStdioProxy(panelHomeOverride?: string): Promise<void> {
  const panelHome = resolvePanelHome(panelHomeOverride || process.env.AGENT_RESUME_PANEL_HOME);
  const projectPath = projectPathFromEnv();
  const clientName = clientNameFromEnv();
  const recordId = `mcp:${clientName}`;

  const fixedHeaders = {
    "X-Agent-Resume-Project": projectPath,
    "X-Agent-Resume-Record": recordId,
    "X-Agent-Resume-Client": clientName
  };

  let cached: BrowserMcpEndpoint | null = null;
  let cachedAt = 0;

  async function endpoint(): Promise<BrowserMcpEndpoint> {
    // Refresh periodically so Desktop restarts pick up new port/token.
    if (!cached || Date.now() - cachedAt > 2_000) {
      cached = await readEndpoint(panelHome);
      cachedAt = Date.now();
    }
    return cached;
  }

  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let message: JsonRpcMessage;
    try {
      message = JSON.parse(trimmed) as JsonRpcMessage;
    } catch {
      writeStdout(errorResponse(null, -32700, "Parse error"));
      continue;
    }

    try {
      const handle = await endpoint();
      const result = await forwardHttp(handle, message, fixedHeaders);

      if (result.status === 401 || result.status === 403) {
        // Token rotated — force reread once.
        cached = null;
        cachedAt = 0;
        const retryHandle = await endpoint();
        const retry = await forwardHttp(retryHandle, message, fixedHeaders);
        if (isNotification(message) && (retry.status === 202 || retry.json == null)) {
          continue;
        }
        if (retry.json != null) {
          if (Array.isArray(retry.json)) {
            for (const item of retry.json) writeStdout(item);
          } else {
            writeStdout(retry.json);
          }
          continue;
        }
        writeStdout(
          errorResponse(
            message.id ?? null,
            -32001,
            `Browser MCP unauthorized (${retry.status}). Is Desktop running with browser enabled?`
          )
        );
        continue;
      }

      if (isNotification(message) && (result.status === 202 || result.json == null)) {
        continue;
      }

      if (result.json != null) {
        if (Array.isArray(result.json)) {
          for (const item of result.json) writeStdout(item);
        } else {
          writeStdout(result.json);
        }
        continue;
      }

      if (result.status >= 200 && result.status < 300 && isNotification(message)) {
        continue;
      }

      writeStdout(
        errorResponse(
          message.id ?? null,
          -32603,
          result.text || `Browser MCP HTTP ${result.status}. Open Agent Resume Desktop first.`
        )
      );
    } catch (error) {
      cached = null;
      cachedAt = 0;
      if (isNotification(message)) continue;
      writeStdout(
        errorResponse(
          message.id ?? null,
          -32000,
          error instanceof Error ? error.message : String(error)
        )
      );
    }
  }
}
