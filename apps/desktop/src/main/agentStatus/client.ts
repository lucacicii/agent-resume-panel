/**
 * Client for the agent-status daemon.
 *
 * Used by Electron main (sensor + UI bridge), by tests, and by the
 * `agent-resume-status` CLI that installed hooks call.
 */

import * as net from "node:net";
import {
  AGENT_STATUS_API_VERSION,
  type AgentStatusEvent,
  type AgentStatusResponse,
  type HelloResult
} from "./types";

export const DEFAULT_REQUEST_TIMEOUT_MS = 5_000;
export const DEFAULT_CONNECT_TIMEOUT_MS = 3_000;

export type AgentStatusClient = {
  readonly hello: HelloResult;
  request: <T>(method: string, params?: unknown, timeoutMs?: number) => Promise<T>;
  subscribe: (handler: (event: AgentStatusEvent) => void) => () => void;
  /** Notified once when the socket goes away, for reconnect logic. */
  onClose: (handler: () => void) => () => void;
  close: () => void;
  readonly closed: boolean;
};

export class AgentStatusClientError extends Error {
  constructor(
    message: string,
    readonly code: string
  ) {
    super(message);
    this.name = "AgentStatusClientError";
  }
}

export async function connectAgentStatusClient(input: {
  socketPath: string;
  role?: "app" | "cli" | "test";
  appVersion?: string;
  connectTimeoutMs?: number;
}): Promise<AgentStatusClient> {
  const connectTimeoutMs = input.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
  const socket = net.connect({ path: input.socketPath });
  socket.setEncoding("utf8");

  const pending = new Map<
    string,
    { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }
  >();
  const eventHandlers = new Set<(event: AgentStatusEvent) => void>();
  const closeHandlers = new Set<() => void>();
  let closed = false;
  let nextId = 0;
  let buffer = "";

  const failAll = (error: Error) => {
    for (const [, entry] of pending) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    pending.clear();
  };

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.destroy();
      reject(
        new AgentStatusClientError(
          `Timed out connecting to the agent-status daemon at ${input.socketPath}.`,
          "connect_timeout"
        )
      );
    }, connectTimeoutMs);
    socket.once("connect", () => {
      clearTimeout(timer);
      resolve();
    });
    socket.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });

  socket.on("data", (chunk: string) => {
    buffer += chunk;
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) dispatch(line);
      newline = buffer.indexOf("\n");
    }
  });

  socket.on("close", () => {
    const wasClosed = closed;
    closed = true;
    failAll(new AgentStatusClientError("agent-status daemon connection closed.", "closed"));
    if (!wasClosed) for (const handler of closeHandlers) handler();
  });
  socket.on("error", (error) => {
    const wasClosed = closed;
    closed = true;
    failAll(error instanceof Error ? error : new Error(String(error)));
    if (!wasClosed) for (const handler of closeHandlers) handler();
  });

  function dispatch(line: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      return;
    }
    if (parsed && typeof parsed === "object" && "event" in parsed) {
      const event = parsed as AgentStatusEvent;
      for (const handler of eventHandlers) handler(event);
      return;
    }
    const response = parsed as AgentStatusResponse;
    const entry = pending.get(response?.id ?? "");
    if (!entry) return;
    pending.delete(response.id);
    clearTimeout(entry.timer);
    if (response.ok) entry.resolve(response.result);
    else entry.reject(new AgentStatusClientError(response.error.message, response.error.code));
  }

  function request<T>(method: string, params?: unknown, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS): Promise<T> {
    if (closed) {
      return Promise.reject(new AgentStatusClientError("agent-status daemon is not connected.", "closed"));
    }
    const id = `c${++nextId}`;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new AgentStatusClientError(`Request ${method} timed out.`, "timeout"));
      }, timeoutMs);
      // The response shape is validated by the server; callers know their method.
      pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
      socket.write(`${JSON.stringify({ id, method, params: params ?? {} })}\n`);
    });
  }

  const hello = await request<HelloResult>("hello", {
    apiVersion: AGENT_STATUS_API_VERSION,
    role: input.role ?? "cli",
    appVersion: input.appVersion
  });
  if (hello.apiVersion !== AGENT_STATUS_API_VERSION) {
    socket.destroy();
    throw new AgentStatusClientError(
      `agent-status daemon speaks API v${hello.apiVersion}, expected v${AGENT_STATUS_API_VERSION}.`,
      "version_mismatch"
    );
  }

  return {
    hello,
    request,
    subscribe(handler) {
      eventHandlers.add(handler);
      void request("status.subscribe").catch(() => undefined);
      return () => {
        eventHandlers.delete(handler);
      };
    },
    onClose(handler) {
      closeHandlers.add(handler);
      return () => {
        closeHandlers.delete(handler);
      };
    },
    close() {
      closed = true;
      socket.destroy();
    },
    get closed() {
      return closed;
    }
  };
}
