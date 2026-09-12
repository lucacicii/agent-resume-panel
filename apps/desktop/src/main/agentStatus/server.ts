/**
 * Unix socket transport for the agent-status daemon.
 *
 * Framing is newline-delimited JSON in both directions: one request per line in,
 * one response line per request out, plus unsolicited `{ event, data }` lines for
 * subscribers. A unix socket is used instead of a loopback port on purpose — a
 * TCP listener on 127.0.0.1 is reachable from any browser page, a socket file is
 * not.
 */

import { chmod, rm } from "node:fs/promises";
import * as net from "node:net";
import type { AgentStatusEvent } from "./types";

/**
 * Hard cap per line. Telemetry frames carry a screen snapshot, so this is far
 * above a normal request but still bounds a hostile or buggy writer.
 */
export const MAX_LINE_BYTES = 1_000_000;

export type RequestContext = {
  /** Mark this connection as a push subscriber. */
  subscribe: () => void;
  /** The raw socket, for diagnostics. */
  readonly remote: string;
};

export type AgentStatusServer = {
  readonly socketPath: string;
  readonly subscriberCount: number;
  /** Push an event to every subscribed connection. */
  broadcast: (event: AgentStatusEvent) => void;
  /** Close the listener, drop connections, and unlink the socket file. */
  close: () => Promise<void>;
};

export type AgentStatusServerHandle = (
  method: string,
  params: unknown,
  context: RequestContext
) => Promise<unknown>;

export async function startAgentStatusServer(input: {
  socketPath: string;
  handle: AgentStatusServerHandle;
  log?: (message: string) => void;
  onError?: (error: unknown, where: string) => void;
}): Promise<AgentStatusServer> {
  const log = input.log ?? (() => undefined);
  const onError = input.onError ?? (() => undefined);
  const subscribers = new Set<net.Socket>();
  const connections = new Set<net.Socket>();

  // A previous crash can leave the socket file behind; binding would fail with
  // EADDRINUSE even though nobody is listening.
  await rm(input.socketPath, { force: true });

  const server = net.createServer((socket) => {
    connections.add(socket);
    let buffer = "";
    let subscribed = false;

    const context: RequestContext = {
      subscribe: () => {
        subscribed = true;
        subscribers.add(socket);
      },
      get remote() {
        return socket.remoteAddress ?? "local";
      }
    };

    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      if (buffer.length > MAX_LINE_BYTES) {
        log("dropping connection: request exceeded the line cap");
        socket.destroy();
        return;
      }
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) void handleLine(line);
        newline = buffer.indexOf("\n");
      }
    });
    socket.on("close", () => {
      connections.delete(socket);
      subscribers.delete(socket);
    });
    socket.on("error", (error) => {
      onError(error, "connection");
    });

    async function handleLine(line: string): Promise<void> {
      let id = "";
      try {
        const parsed = JSON.parse(line) as { id?: unknown; method?: unknown; params?: unknown };
        id = typeof parsed.id === "string" ? parsed.id : "";
        const method = typeof parsed.method === "string" ? parsed.method : "";
        if (!method) {
          reply({ id, ok: false, error: { code: "bad_request", message: "Missing method." } });
          return;
        }
        const result = await input.handle(method, parsed.params, context);
        reply({ id, ok: true, result: result ?? null });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const code = (error as { code?: unknown })?.code;
        reply({
          id,
          ok: false,
          error: { code: typeof code === "string" ? code : "handler_error", message }
        });
      }
    }

    function reply(response: unknown): void {
      if (socket.destroyed) return;
      socket.write(`${JSON.stringify(response)}\n`);
    }

    // Subscriber flag is read on every broadcast; expose it for diagnostics.
    socket.on("close", () => {
      if (subscribed) log("subscriber disconnected");
    });
  });

  server.on("error", (error) => {
    onError(error, "server");
  });

  await new Promise<void>((resolve, reject) => {
    const onListenError = (error: unknown) => reject(error);
    server.once("error", onListenError);
    server.listen(input.socketPath, () => {
      server.off("error", onListenError);
      resolve();
    });
  });

  await chmod(input.socketPath, 0o600);

  return {
    socketPath: input.socketPath,
    get subscriberCount() {
      return subscribers.size;
    },
    broadcast(event) {
      const line = `${JSON.stringify(event)}\n`;
      for (const socket of subscribers) {
        if (socket.destroyed) continue;
        socket.write(line);
      }
    },
    async close() {
      for (const socket of connections) socket.destroy();
      connections.clear();
      subscribers.clear();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(input.socketPath, { force: true });
    }
  };
}
