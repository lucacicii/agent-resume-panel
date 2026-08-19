import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import type { BrowserController } from "./controller";
import { clearBrowserMcpEndpoint, publishBrowserMcpEndpoint } from "./endpoint";
import {
  BROWSER_TOOL_INSTRUCTIONS,
  invokeBrowserTool,
  listBrowserToolDescriptors,
  type BrowserToolContext
} from "./tools";

export const BROWSER_MCP_SERVER_NAME = "agent-resume-browser";

export type BrowserMcpServerHandle = {
  url: string;
  token: string;
  port: number;
  close: () => Promise<void>;
};

type BrowserMcpPublishOptions = {
  /** Panel home used for endpoint file discovery by external stdio proxies. */
  panelHome?: string;
  /** When false, skip writing endpoint file (ACP-only). Default true when panelHome set. */
  publishEndpoint?: boolean;
};

let sharedPanelHome = "";

type JsonRpcId = string | number | null;

type JsonRpcRequest = {
  jsonrpc?: string;
  id?: JsonRpcId;
  method?: string;
  params?: Record<string, unknown>;
};

let shared: BrowserMcpServerHandle | null = null;
let sharedController: BrowserController | null = null;
let sharedToken = "";

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
      if (chunks.reduce((n, c) => n + c.length, 0) > 4 * 1024 * 1024) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers":
      "content-type, authorization, mcp-session-id, x-agent-resume-project, x-agent-resume-record, x-agent-resume-client",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS"
  });
  res.end(payload);
}

function unauthorized(res: ServerResponse): void {
  sendJson(res, 401, {
    jsonrpc: "2.0",
    error: { code: -32001, message: "Unauthorized" },
    id: null
  });
}

function parseAuth(req: IncomingMessage): string | null {
  const header = req.headers.authorization;
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1]?.trim() || null;
}

function toolContextFromHeaders(req: IncomingMessage): BrowserToolContext {
  if (!sharedController) throw new Error("Browser controller not ready.");
  const projectPath =
    (typeof req.headers["x-agent-resume-project"] === "string" && req.headers["x-agent-resume-project"]) ||
    (typeof req.headers["x-project-path"] === "string" && req.headers["x-project-path"]) ||
    "";
  const recordId =
    (typeof req.headers["x-agent-resume-record"] === "string" && req.headers["x-agent-resume-record"]) ||
    (typeof req.headers["x-record-id"] === "string" && req.headers["x-record-id"]) ||
    "";
  const clientName =
    (typeof req.headers["x-agent-resume-client"] === "string" && req.headers["x-agent-resume-client"]) ||
    "";
  const trimmedRecord = recordId.trim();
  const ownerKind: BrowserToolContext["ownerKind"] =
    trimmedRecord.startsWith("mcp:") || clientName.trim() ? "mcp-client" : "acp";
  return {
    controller: sharedController,
    projectPath: projectPath.trim() || "unknown",
    recordId: trimmedRecord || clientName.trim() || "unknown",
    ownerKind,
    clientName: clientName.trim() || undefined
  };
}

async function handleJsonRpc(req: IncomingMessage, message: JsonRpcRequest): Promise<unknown> {
  const id = message.id ?? null;
  const method = message.method || "";
  const params = (message.params || {}) as Record<string, unknown>;

  if (method === "initialize") {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: BROWSER_MCP_SERVER_NAME, version: "0.1.0" },
        instructions: BROWSER_TOOL_INSTRUCTIONS
      }
    };
  }

  if (method === "notifications/initialized" || method === "initialized") {
    return null;
  }

  if (method === "ping") {
    return { jsonrpc: "2.0", id, result: {} };
  }

  if (method === "tools/list") {
    const tools = listBrowserToolDescriptors().map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema
    }));
    return { jsonrpc: "2.0", id, result: { tools } };
  }

  if (method === "tools/call") {
    const name = typeof params.name === "string" ? params.name : "";
    const args =
      params.arguments && typeof params.arguments === "object" && !Array.isArray(params.arguments)
        ? (params.arguments as Record<string, unknown>)
        : {};
    const ctx = toolContextFromHeaders(req);
    if ((!ctx.projectPath || ctx.projectPath === "unknown") && typeof args.projectPath === "string") {
      ctx.projectPath = args.projectPath;
    }
    if ((!ctx.recordId || ctx.recordId === "unknown") && typeof args.recordId === "string") {
      ctx.recordId = args.recordId;
    }
    const result = await invokeBrowserTool(name, args, ctx);
    return {
      jsonrpc: "2.0",
      id,
      result: {
        content: result.content,
        isError: result.isError === true
      }
    };
  }

  if (method === "resources/list") {
    return { jsonrpc: "2.0", id, result: { resources: [] } };
  }

  if (method === "prompts/list") {
    return { jsonrpc: "2.0", id, result: { prompts: [] } };
  }

  return {
    jsonrpc: "2.0",
    id,
    error: { code: -32601, message: `Method not found: ${method}` }
  };
}

/**
 * Start (or reuse) a loopback-only MCP JSON-RPC HTTP server that drives BrowserController.
 * Auth: Bearer token required on every request.
 * When `panelHome` is provided (or was set earlier), publishes endpoint JSON for TUI stdio proxy.
 */
export async function ensureBrowserMcpServer(
  controller: BrowserController,
  options?: BrowserMcpPublishOptions
): Promise<BrowserMcpServerHandle> {
  sharedController = controller;
  if (options?.panelHome?.trim()) {
    sharedPanelHome = options.panelHome.trim();
  }

  if (shared) {
    if (sharedPanelHome && options?.publishEndpoint !== false) {
      try {
        await publishBrowserMcpEndpoint(shared, sharedPanelHome);
      } catch (error) {
        console.warn(
          "[browser-mcp] failed to publish endpoint:",
          error instanceof Error ? error.message : String(error)
        );
      }
    }
    return shared;
  }

  sharedToken = randomBytes(24).toString("hex");

  const server: Server = createServer(async (req, res) => {
    try {
      if (req.method === "OPTIONS") {
        res.writeHead(204, {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers":
            "content-type, authorization, mcp-session-id, x-agent-resume-project, x-agent-resume-record, x-agent-resume-client",
          "Access-Control-Allow-Methods": "POST, GET, OPTIONS"
        });
        res.end();
        return;
      }

      if (parseAuth(req) !== sharedToken) {
        unauthorized(res);
        return;
      }

      if (req.method === "GET") {
        sendJson(res, 200, {
          name: BROWSER_MCP_SERVER_NAME,
          version: "0.1.0",
          transport: "http-jsonrpc",
          instructions: BROWSER_TOOL_INSTRUCTIONS
        });
        return;
      }

      if (req.method !== "POST") {
        sendJson(res, 405, { error: "Method not allowed" });
        return;
      }

      const raw = await readBody(req);
      let parsed: unknown;
      try {
        parsed = raw ? JSON.parse(raw) : {};
      } catch {
        sendJson(res, 400, {
          jsonrpc: "2.0",
          error: { code: -32700, message: "Parse error" },
          id: null
        });
        return;
      }

      if (Array.isArray(parsed)) {
        const results = [];
        for (const item of parsed) {
          const out = await handleJsonRpc(req, (item || {}) as JsonRpcRequest);
          if (out != null) results.push(out);
        }
        sendJson(res, 200, results);
        return;
      }

      const out = await handleJsonRpc(req, (parsed || {}) as JsonRpcRequest);
      if (out == null) {
        res.writeHead(202, {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "content-type, authorization"
        });
        res.end();
        return;
      }
      sendJson(res, 200, out);
    } catch (error) {
      sendJson(res, 500, {
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message: error instanceof Error ? error.message : String(error)
        },
        id: null
      });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Failed to bind browser MCP server.");
  }

  const port = address.port;
  // Path-agnostic handler; /mcp is the advertised endpoint for ACP McpServerHttp.
  const url = `http://127.0.0.1:${port}/mcp`;

  shared = {
    url,
    token: sharedToken,
    port,
    close: () =>
      new Promise((resolve) => {
        server.close(() => {
          if (shared?.port === port) {
            shared = null;
            sharedToken = "";
          }
          resolve();
        });
      })
  };

  if (sharedPanelHome && options?.publishEndpoint !== false) {
    try {
      await publishBrowserMcpEndpoint(shared, sharedPanelHome);
    } catch (error) {
      console.warn(
        "[browser-mcp] failed to publish endpoint:",
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  return shared;
}

export function getBrowserMcpServer(): BrowserMcpServerHandle | null {
  return shared;
}

export async function disposeBrowserMcpServer(): Promise<void> {
  if (sharedPanelHome) {
    try {
      await clearBrowserMcpEndpoint(sharedPanelHome);
    } catch {
      // best-effort
    }
  }
  if (!shared) {
    sharedController = null;
    return;
  }
  await shared.close();
  sharedController = null;
  sharedPanelHome = "";
}
