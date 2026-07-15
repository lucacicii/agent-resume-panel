import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export interface McpToolInfo {
  name: string;
  description?: string;
  inputSchema: {
    type: "object";
    properties?: Record<string, unknown>;
    required?: string[];
  };
}

export interface McpToolCallResult {
  content: Array<{ type: string; text?: string }>;
  isError?: boolean;
}

export class NoteMcpClient {
  private client: Client | null = null;
  private stdioTransport: StdioClientTransport | null = null;
  private inMemoryTransport: InMemoryTransport | null = null;

  /**
   * Connect to an MCP server via stdio by spawning a child process.
   * Use this for external server scenarios (e.g. running a standalone CLI).
   * Not suitable for Electron main process — use connectInMemory instead.
   */
  async startStdio(serverCommand: string, serverArgs: string[] = [], env?: Record<string, string>): Promise<void> {
    if (this.client) {
      return;
    }
    const transportOptions: { command: string; args: string[]; env?: Record<string, string> } = {
      command: serverCommand,
      args: serverArgs
    };
    if (env) {
      transportOptions.env = env;
    }
    this.stdioTransport = new StdioClientTransport(transportOptions);
    this.client = new Client(
      { name: "agent-resume-ask", version: "0.1.0" }
    );
    await this.client.connect(this.stdioTransport);
  }

  /**
   * Connect to an MCP server via in-memory transport within the same process.
   * Use this when the server object is available locally (e.g. Electron main).
   * Avoids spawning child processes entirely.
   */
  async connectInMemory(server: McpServer): Promise<void> {
    if (this.client) {
      return;
    }
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    this.inMemoryTransport = clientTransport;
    this.client = new Client(
      { name: "agent-resume-ask", version: "0.1.0" }
    );
    await this.client.connect(clientTransport);
  }

  async listTools(): Promise<McpToolInfo[]> {
    if (!this.client) {
      throw new Error("MCP client not started.");
    }
    const result = await this.client.listTools();
    return result.tools as McpToolInfo[];
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<McpToolCallResult> {
    if (!this.client) {
      throw new Error("MCP client not started.");
    }
    const result = await this.client.callTool({ name, arguments: args });
    return result as unknown as McpToolCallResult;
  }

  async stop(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
      this.stdioTransport = null;
      this.inMemoryTransport = null;
    }
  }
}

export function convertMcpToolsToOpenAiFormat(tools: McpToolInfo[]): Array<{
  type: "function";
  function: { name: string; description?: string; parameters: object };
}> {
  return tools.map((tool) => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema || { type: "object", properties: {} }
    }
  }));
}
