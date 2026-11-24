import { EventEmitter } from "node:events";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import {
  FRAME_AUTOMATIC_INPUT,
  FRAME_CLOSE,
  FRAME_CREDIT,
  FRAME_DATA,
  FRAME_FOCUS,
  FRAME_RESIZE,
  MAX_FRAME_PAYLOAD,
  type HcAttachParams,
  type HcAttachResult,
  type HcFrame,
  type HcHelloResult,
  type HcListResult,
  type HcRunParams,
  type HcStatusResult,
  type HcSubscribeResult,
  type HcTerminal
} from "./types";

interface RpcResponse<T = unknown> {
  jsonrpc: string;
  id: number;
  result?: T;
  error?: { code: number; message: string; data?: unknown };
}

export function defaultHerdrSocketPath(): string {
  const envSock = process.env.HC_SOCKET?.trim();
  if (envSock) {
    return envSock;
  }
  return path.join(os.homedir(), ".local", "state", "herdr-core", "default", "default.sock");
}

/**
 * Pure TypeScript Unix Domain Socket client for herdr-core (hc).
 */
export class HcClient {
  private nextId = 1;
  private socketPath: string;

  constructor(socketPath = "") {
    this.socketPath = socketPath.trim() || defaultHerdrSocketPath();
  }

  getSocketPath(): string {
    return this.socketPath;
  }

  setSocketPath(socketPath: string): void {
    this.socketPath = socketPath.trim() || defaultHerdrSocketPath();
  }

  call<T = unknown>(method: string, params: unknown = {}, timeoutMs = 6000): Promise<T> {
    const id = this.nextId++;
    const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";

    return new Promise<T>((resolve, reject) => {
      const socket = net.createConnection({ path: this.socketPath });
      let buffer: Buffer = Buffer.alloc(0);
      let settled = false;

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          socket.destroy();
          reject(new Error(`hc RPC "${method}" timed out after ${timeoutMs}ms`));
        }
      }, timeoutMs);

      const finish = (err?: Error, val?: T): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        socket.destroy();
        if (err) {
          reject(err);
        } else {
          resolve(val as T);
        }
      };

      socket.once("error", (err) => {
        finish(new Error(`dial hc socket ${this.socketPath}: ${err.message}`));
      });

      socket.once("connect", () => {
        socket.write(payload);
      });

      socket.on("data", (chunk: Buffer) => {
        buffer = buffer.length > 0 ? Buffer.concat([buffer, chunk]) : chunk;
        const nl = buffer.indexOf(0x0a);
        if (nl === -1) {
          return;
        }
        const line = buffer.subarray(0, nl).toString("utf8");
        try {
          const resp = JSON.parse(line) as RpcResponse<T>;
          if (resp.error) {
            finish(new Error(`hc rpc error (${resp.error.code}): ${resp.error.message}`));
            return;
          }
          finish(undefined, resp.result as T);
        } catch (err) {
          finish(err instanceof Error ? err : new Error(String(err)));
        }
      });

      socket.once("end", () => {
        if (!settled) {
          finish(new Error(`hc socket closed before responding to "${method}"`));
        }
      });
    });
  }

  serverStatus(timeoutMs = 1200): Promise<HcStatusResult> {
    return this.call<HcStatusResult>("server.status", {}, timeoutMs);
  }

  listTerminals(includeFinished = true): Promise<HcListResult> {
    return this.call<HcListResult>("terminal.list", { all: includeFinished });
  }

  getTerminal(terminal: string): Promise<HcTerminal> {
    return this.call<HcTerminal>("terminal.get", { terminal });
  }

  async runTerminal(params: HcRunParams): Promise<HcTerminal> {
    const raw = await this.call<HcTerminal | { terminal: HcTerminal }>("terminal.run", params);
    if (raw && "address" in raw && typeof raw.address === "string") {
      return raw;
    }
    if (raw && "terminal" in raw && raw.terminal) {
      return raw.terminal;
    }
    throw new Error("Unexpected terminal.run response from hc");
  }

  setLabels(terminal: string, labels: Record<string, string>): Promise<void> {
    return this.call<void>("terminal.label", { terminal, labels });
  }

  async docGet<T = unknown>(name: string): Promise<T> {
    const res = await this.call<{ value: T; version: number }>("doc.get", { name });
    return res.value;
  }

  async attach(params: HcAttachParams): Promise<HcAttachStream> {
    const fc = await FramedConnection.connect(this.socketPath);
    try {
      const meta = await fc.callFramed<HcAttachResult>("terminal.attach", params);
      return new HcAttachStream(fc, meta);
    } catch (err) {
      fc.close();
      throw err;
    }
  }

  async subscribeEvents(): Promise<HcEventStream> {
    const fc = await FramedConnection.connect(this.socketPath);
    try {
      const initial = await fc.callFramed<HcSubscribeResult>("events.subscribe", {});
      if (initial.channel === null || initial.channel === undefined) {
        throw new Error("events.subscribe did not return a framed channel");
      }
      return new HcEventStream(fc, initial.channel, initial);
    } catch (err) {
      fc.close();
      throw err;
    }
  }
}

export class FramedConnection extends EventEmitter {
  private buffer: Buffer = Buffer.alloc(0);
  private nextId = 100;
  private pendingRpc = new Map<
    number,
    { resolve: (val: unknown) => void; reject: (err: Error) => void }
  >();
  private closed = false;

  private constructor(
    private readonly socket: net.Socket,
    readonly hello: HcHelloResult,
    initialTrailing: Buffer
  ) {
    super();
    if (initialTrailing.length > 0) {
      this.buffer = initialTrailing;
    }

    socket.on("data", (chunk: Buffer) => {
      this.buffer = this.buffer.length > 0 ? Buffer.concat([this.buffer, chunk]) : chunk;
      this.drainFrames();
    });

    socket.on("error", (err) => {
      this.handleDisconnect(err.message);
    });

    socket.on("close", () => {
      this.handleDisconnect("socket closed");
    });

    if (this.buffer.length > 0) {
      queueMicrotask(() => this.drainFrames());
    }
  }

  static connect(socketPath: string, timeoutMs = 4000): Promise<FramedConnection> {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ path: socketPath });
      let handshakeBuf: Buffer = Buffer.alloc(0);
      let done = false;

      const timer = setTimeout(() => {
        if (!done) {
          done = true;
          socket.destroy();
          reject(new Error(`hc framed handshake timed out (${socketPath})`));
        }
      }, timeoutMs);

      const fail = (err: Error): void => {
        if (done) {
          return;
        }
        done = true;
        clearTimeout(timer);
        socket.destroy();
        reject(err);
      };

      const onError = (err: Error): void => fail(new Error(`dial hc socket ${socketPath}: ${err.message}`));
      const onClose = (): void => fail(new Error("hc socket closed during hello handshake"));

      const onData = (chunk: Buffer): void => {
        handshakeBuf = handshakeBuf.length > 0 ? Buffer.concat([handshakeBuf, chunk]) : chunk;
        const nl = handshakeBuf.indexOf(0x0a);
        if (nl === -1) {
          return;
        }

        const line = handshakeBuf.subarray(0, nl).toString("utf8");
        const trailing = Buffer.from(handshakeBuf.subarray(nl + 1));

        let resp: RpcResponse<HcHelloResult>;
        try {
          resp = JSON.parse(line) as RpcResponse<HcHelloResult>;
        } catch (err) {
          fail(err instanceof Error ? err : new Error(String(err)));
          return;
        }

        if (resp.error) {
          fail(new Error(`hc hello error (${resp.error.code}): ${resp.error.message}`));
          return;
        }
        if (!resp.result?.framed) {
          fail(new Error("hc refused framed mode"));
          return;
        }

        done = true;
        clearTimeout(timer);
        socket.off("data", onData);
        socket.off("error", onError);
        socket.off("close", onClose);
        resolve(new FramedConnection(socket, resp.result, trailing));
      };

      socket.on("error", onError);
      socket.on("close", onClose);
      socket.on("data", onData);

      socket.once("connect", () => {
        const helloReq = JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "hello",
          params: { framed: true }
        });
        socket.write(helloReq + "\n");
      });
    });
  }

  private drainFrames(): void {
    while (this.buffer.length >= 9) {
      const channel = this.buffer.readUInt32LE(0);
      const kind = this.buffer.readUInt8(4);
      const length = this.buffer.readUInt32LE(5);

      if (length > MAX_FRAME_PAYLOAD) {
        this.handleDisconnect(`frame length exceeds limit: ${length}`);
        this.socket.destroy();
        return;
      }

      if (this.buffer.length < 9 + length) {
        return;
      }

      const payload = Buffer.from(this.buffer.subarray(9, 9 + length));
      this.buffer = this.buffer.subarray(9 + length);

      if (channel === 0 && kind === FRAME_DATA) {
        this.handleControlPayload(payload);
      } else {
        this.emit("frame", { channel, kind, payload } satisfies HcFrame);
      }
    }
  }

  private handleControlPayload(payload: Buffer): void {
    try {
      const resp = JSON.parse(payload.toString("utf8")) as RpcResponse<unknown>;
      const pending = this.pendingRpc.get(resp.id);
      if (!pending) {
        return;
      }
      this.pendingRpc.delete(resp.id);
      if (resp.error) {
        pending.reject(new Error(`hc rpc error (${resp.error.code}): ${resp.error.message}`));
      } else {
        pending.resolve(resp.result);
      }
    } catch (err) {
      this.emit("error", err instanceof Error ? err : new Error(String(err)));
    }
  }

  private handleDisconnect(reason: string): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    for (const pending of this.pendingRpc.values()) {
      pending.reject(new Error(`hc framed connection closed: ${reason}`));
    }
    this.pendingRpc.clear();
    this.emit("close", reason);
  }

  writeFrame(channel: number, kind: number, payload: Buffer = Buffer.alloc(0)): void {
    if (this.closed || this.socket.destroyed) {
      return;
    }
    if (payload.length > MAX_FRAME_PAYLOAD) {
      throw new Error(`frame payload too large: ${payload.length}`);
    }
    const hdr = Buffer.allocUnsafe(9);
    hdr.writeUInt32LE(channel >>> 0, 0);
    hdr.writeUInt8(kind & 0xff, 4);
    hdr.writeUInt32LE(payload.length >>> 0, 5);
    this.socket.write(payload.length > 0 ? Buffer.concat([hdr, payload]) : hdr);
  }

  callFramed<T = unknown>(method: string, params: unknown = {}, timeoutMs = 6000): Promise<T> {
    if (this.closed) {
      return Promise.reject(new Error("framed connection is closed"));
    }
    const id = this.nextId++;
    const req = JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pendingRpc.delete(id)) {
          reject(new Error(`framed RPC "${method}" timed out after ${timeoutMs}ms`));
        }
      }, timeoutMs);

      this.pendingRpc.set(id, {
        resolve: (val) => {
          clearTimeout(timer);
          resolve(val as T);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        }
      });

      this.writeFrame(0, FRAME_DATA, Buffer.from(req, "utf8"));
    });
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.handleDisconnect("closed by client");
    this.socket.destroy();
  }
}

export class HcAttachStream extends EventEmitter {
  readonly channel: number;
  private closed = false;
  private lastCols: number;
  private lastRows: number;

  constructor(
    private readonly fc: FramedConnection,
    readonly meta: HcAttachResult
  ) {
    super();
    this.channel = meta.channel;
    this.lastCols = meta.terminal.cols;
    this.lastRows = meta.terminal.rows;

    fc.on("frame", (frame: HcFrame) => {
      if (frame.channel !== this.channel) {
        return;
      }
      switch (frame.kind) {
        case FRAME_DATA:
          if (frame.payload.length > 0) {
            this.emit("data", frame.payload);
            this.sendCredit(frame.payload.length);
          }
          break;
        case FRAME_RESIZE:
          if (frame.payload.length === 4) {
            const cols = frame.payload.readUInt16LE(0);
            const rows = frame.payload.readUInt16LE(2);
            this.lastCols = cols;
            this.lastRows = rows;
            this.emit("resize", { cols, rows });
          }
          break;
        case FRAME_CLOSE:
          this.closed = true;
          this.emit("close", "remote_close");
          this.fc.close();
          break;
      }
    });

    fc.on("close", (reason: string) => {
      if (!this.closed) {
        this.closed = true;
        this.emit("close", reason);
      }
    });
  }

  private sendCredit(bytes: number): void {
    if (bytes <= 0 || this.closed) {
      return;
    }
    const buf = Buffer.allocUnsafe(4);
    buf.writeUInt32LE(bytes >>> 0, 0);
    this.fc.writeFrame(this.channel, FRAME_CREDIT, buf);
  }

  writeData(data: string | Buffer): void {
    if (this.closed) {
      return;
    }
    const buf = typeof data === "string" ? Buffer.from(data, "utf8") : data;
    if (buf.length > 0) {
      this.fc.writeFrame(this.channel, FRAME_DATA, buf);
    }
  }

  writeAutomaticInput(data: string | Buffer): void {
    if (this.closed) {
      return;
    }
    const buf = typeof data === "string" ? Buffer.from(data, "utf8") : data;
    if (buf.length === 0) {
      return;
    }
    const kind = this.meta.automatic_input ? FRAME_AUTOMATIC_INPUT : FRAME_DATA;
    this.fc.writeFrame(this.channel, kind, buf);
  }

  resize(cols: number, rows: number): void {
    if (this.closed || cols <= 0 || rows <= 0) {
      return;
    }
    if (cols === this.lastCols && rows === this.lastRows) {
      return;
    }
    this.lastCols = cols;
    this.lastRows = rows;
    const buf = Buffer.allocUnsafe(4);
    buf.writeUInt16LE(cols & 0xffff, 0);
    buf.writeUInt16LE(rows & 0xffff, 2);
    this.fc.writeFrame(this.channel, FRAME_RESIZE, buf);
  }

  focus(focused: boolean): void {
    if (this.closed) {
      return;
    }
    this.fc.writeFrame(this.channel, FRAME_FOCUS, Buffer.from([focused ? 1 : 0]));
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    try {
      this.fc.writeFrame(this.channel, FRAME_CLOSE);
    } catch {
      // ignore
    }
    this.fc.close();
  }
}

export class HcEventStream extends EventEmitter {
  private closed = false;

  constructor(
    private readonly fc: FramedConnection,
    readonly channel: number,
    readonly initial: HcSubscribeResult
  ) {
    super();

    fc.on("frame", (frame: HcFrame) => {
      if (frame.channel !== this.channel) {
        return;
      }
      if (frame.kind === FRAME_CLOSE) {
        this.closed = true;
        this.emit("close", "remote_close");
        this.fc.close();
        return;
      }
      if (frame.kind === FRAME_DATA && frame.payload.length > 0) {
        const credit = Buffer.allocUnsafe(4);
        credit.writeUInt32LE(frame.payload.length >>> 0, 0);
        this.fc.writeFrame(this.channel, FRAME_CREDIT, credit);
        try {
          const parsed = JSON.parse(frame.payload.toString("utf8")) as unknown;
          this.emit("event", parsed);
        } catch {
          // ignore
        }
      }
    });

    fc.on("close", (reason: string) => {
      if (!this.closed) {
        this.closed = true;
        this.emit("close", reason);
      }
    });
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    try {
      this.fc.writeFrame(this.channel, FRAME_CLOSE);
    } catch {
      // ignore
    }
    this.fc.close();
  }
}
