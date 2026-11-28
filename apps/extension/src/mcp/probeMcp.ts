import { spawn } from "node:child_process";
import type { McpLaunchSpec } from "./configWriters";

export interface McpProbeResult {
  ok: boolean;
  command: string;
  tools: string[];
  durationMs: number;
  error?: string;
}

const PROBE_TIMEOUT_MS = 4_500;

export function probeMcpStdioServer(spec: McpLaunchSpec): Promise<McpProbeResult> {
  const startedAt = Date.now();
  const displayCommand = [spec.command, ...spec.args].join(" ");

  return new Promise((resolve) => {
    let settled = false;
    let buffer = "";
    let stderrBuf = "";
    let initializedSent = false;

    const child = spawn(spec.command, spec.args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...(spec.env ?? {}) }
    });

    const finish = (result: Omit<McpProbeResult, "command" | "durationMs">) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      try {
        child.stdin?.end();
      } catch {
        // ignore
      }
      try {
        child.kill();
      } catch {
        // ignore
      }
      resolve({
        ...result,
        command: displayCommand,
        durationMs: Date.now() - startedAt
      });
    };

    const timer = setTimeout(() => {
      finish({
        ok: false,
        tools: [],
        error: `Timed out after ${PROBE_TIMEOUT_MS}ms waiting for MCP handshake.${stderrBuf.trim() ? ` (${stderrBuf.trim()})` : ""}`
      });
    }, PROBE_TIMEOUT_MS);

    child.on("error", (err) => {
      finish({
        ok: false,
        tools: [],
        error: err.message
      });
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderrBuf.length < 1024) {
        stderrBuf += chunk.toString("utf8");
      }
    });

    child.on("exit", (code) => {
      if (!settled) {
        finish({
          ok: false,
          tools: [],
          error: `Process exited early with code ${code ?? "null"}${stderrBuf.trim() ? `: ${stderrBuf.trim()}` : ""}`
        });
      }
    });

    child.stdout?.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      let newlineIdx = buffer.indexOf("\n");
      while (newlineIdx >= 0) {
        const line = buffer.slice(0, newlineIdx).trim();
        buffer = buffer.slice(newlineIdx + 1);
        newlineIdx = buffer.indexOf("\n");
        if (!line) {
          continue;
        }
        let msg: { id?: number; error?: { message?: string }; result?: { tools?: Array<{ name?: string }> } };
        try {
          msg = JSON.parse(line) as typeof msg;
        } catch {
          continue;
        }
        if (msg.id === 1) {
          if (msg.error) {
            finish({ ok: false, tools: [], error: msg.error.message || "MCP initialize failed" });
            return;
          }
          if (!initializedSent) {
            initializedSent = true;
            child.stdin?.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
            child.stdin?.write(
              `${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })}\n`
            );
          }
        } else if (msg.id === 2) {
          if (msg.error) {
            finish({ ok: false, tools: [], error: msg.error.message || "MCP tools/list failed" });
            return;
          }
          const tools = Array.isArray(msg.result?.tools)
            ? msg.result.tools.map((tool) => tool.name).filter((name): name is string => Boolean(name))
            : [];
          finish({ ok: true, tools });
          return;
        }
      }
    });

    child.stdin?.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "agent-resume-check", version: "1.0.0" }
        }
      })}\n`
    );
  });
}
