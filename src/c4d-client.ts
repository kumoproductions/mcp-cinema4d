import net from "node:net";
import { randomUUID } from "node:crypto";

export interface C4DRequest {
  id: string;
  command: string;
  params: Record<string, unknown>;
  token?: string;
}

export interface C4DResponse {
  id: string;
  status: "ok" | "error";
  result?: unknown;
  error?: string;
}

export interface C4DClientOptions {
  host?: string;
  port?: number;
  connectTimeoutMs?: number;
  token?: string;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

export class C4DClient {
  private readonly host: string;
  private readonly port: number;
  private readonly connectTimeoutMs: number;
  private readonly token: string | undefined;
  private socket: net.Socket | null = null;
  private connecting: Promise<net.Socket> | null = null;
  private buffer = "";
  private pending = new Map<string, PendingRequest>();

  constructor(options: C4DClientOptions = {}) {
    this.host = options.host ?? "127.0.0.1";
    this.port = options.port ?? 18710;
    this.connectTimeoutMs = options.connectTimeoutMs ?? 5000;
    this.token = options.token;
  }

  private connect(): Promise<net.Socket> {
    if (this.socket && !this.socket.destroyed) {
      return Promise.resolve(this.socket);
    }
    if (this.connecting) {
      return this.connecting;
    }

    this.connecting = new Promise<net.Socket>((resolve, reject) => {
      const socket = new net.Socket();
      const onError = (err: Error) => {
        socket.destroy();
        this.connecting = null;
        reject(
          new Error(
            `Cannot connect to Cinema 4D bridge at ${this.host}:${this.port} — ${err.message}. Make sure Cinema 4D is running and the cinema4d_mcp_bridge plugin is loaded.`,
          ),
        );
      };
      socket.once("error", onError);
      socket.setTimeout(this.connectTimeoutMs, () => {
        onError(new Error(`connect timed out after ${this.connectTimeoutMs}ms`));
      });
      socket.connect(this.port, this.host, () => {
        socket.setTimeout(0);
        socket.off("error", onError);
        socket.on("error", (err) => this.onSocketError(err));
        socket.on("close", () => this.onSocketClose());
        socket.on("data", (chunk) => this.onData(chunk));
        this.socket = socket;
        this.connecting = null;
        resolve(socket);
      });
    });

    return this.connecting;
  }

  private onData(chunk: Buffer): void {
    this.buffer += chunk.toString("utf8");
    let newlineIndex: number;
    while ((newlineIndex = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, newlineIndex).trim();
      this.buffer = this.buffer.slice(newlineIndex + 1);
      if (!line) continue;
      this.dispatchResponse(line);
    }
  }

  private dispatchResponse(line: string): void {
    let msg: C4DResponse;
    try {
      msg = JSON.parse(line) as C4DResponse;
    } catch {
      return;
    }
    const pending = this.pending.get(msg.id);
    if (!pending) return;
    this.pending.delete(msg.id);
    clearTimeout(pending.timer);
    if (msg.status === "ok") {
      pending.resolve(msg.result);
    } else {
      pending.reject(new Error(msg.error ?? "unknown error from Cinema 4D"));
    }
  }

  private onSocketError(err: Error): void {
    this.failAllPending(new Error(`C4D bridge socket error: ${err.message}`));
  }

  private onSocketClose(): void {
    this.socket = null;
    this.buffer = "";
    this.failAllPending(new Error("C4D bridge socket closed"));
  }

  private failAllPending(err: Error): void {
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(err);
    }
    this.pending.clear();
  }

  async request<T = unknown>(
    command: string,
    params: Record<string, unknown> = {},
    timeoutMs = 10_000,
  ): Promise<T> {
    const socket = await this.connect();
    const id = randomUUID();
    const payload: C4DRequest = { id, command, params };
    if (this.token) payload.token = this.token;

    return await new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Command "${command}" timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timer,
      });
      socket.write(JSON.stringify(payload) + "\n", (err) => {
        if (err) {
          this.pending.delete(id);
          clearTimeout(timer);
          reject(err);
        }
      });
    });
  }

  close(): void {
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
    this.failAllPending(new Error("client closed"));
  }
}
