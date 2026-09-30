import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { C4DClient } from "./c4d-client.js";

const TRUTHY = new Set(["1", "true", "yes", "on"]);

/**
 * Whether this MCP server process has opted IN to multi-instance mode.
 *
 * Off by default: the instance tools stay hidden, no `instance` argument is
 * added to the other tools, and every call goes to the one bridge named by
 * C4D_MCP_HOST / C4D_MCP_PORT — exactly the single-instance behaviour.
 * Launching a process is a new capability compared to talking to an existing
 * one, so it is gated the same way exec_python is.
 */
export function multiInstanceEnabled(): boolean {
  const flag = process.env.C4D_MCP_ENABLE_MULTIINSTANCE ?? "";
  return TRUTHY.has(flag.trim().toLowerCase());
}

/** Total instance slots including the primary, unless C4D_MCP_MAX_INSTANCES overrides it. */
export const DEFAULT_MAX_INSTANCES = 3;

// A launched instance may stay silent this long before list_instances stops
// calling it "starting". A cold C4D 2026 start with a few render plugins
// takes 1–2 minutes; 5 minutes leaves room for slow disks.
const STARTING_GRACE_MS = 5 * 60_000;
const READY_POLL_MS = 2_000;
// Ports of instances we stopped are avoided for a while: on Windows the
// bridge binds with SO_EXCLUSIVEADDRUSE, which fails while the previous
// connections on that port sit in TIME_WAIT (see bridge/server.py).
const PORT_COOLDOWN_MS = 4 * 60_000;
const PROBE_CONNECT_TIMEOUT_MS = 3_000;
const PROBE_REQUEST_TIMEOUT_MS = 3_000;
const KILL_GRACE_MS = 10_000;

export type InstanceStatus = "ready" | "starting" | "unreachable";

export interface InstanceInfo {
  id: number;
  port: number;
  host: string;
  status: InstanceStatus;
  active: boolean;
  /** true when this server started the process (launch_instance). */
  managed: boolean;
  pid: number | null;
  c4d_version: number | null;
  log_path: string | null;
  launched_at: string | null;
}

interface InstanceRecord {
  id: number;
  port: number;
  managed: boolean;
  pid: number | null;
  child: ChildProcess | null;
  client: C4DClient;
  launchedAt: number | null;
  logPath: string | null;
  exit: { code: number | null; signal: string | null } | null;
  spawnError: Error | null;
}

export interface InstanceRegistryOptions {
  host: string;
  basePort: number;
  token?: string;
  maxInstances?: number;
  /** Cinema 4D executable for launch_instance; auto-detected when omitted. */
  exePath?: string;
  log?: (message: string) => void;
}

interface PingReply {
  pong?: boolean;
  c4d_version?: number;
  pid?: number;
}

/**
 * Tracks every Cinema 4D bridge this server talks to. Instance ids are port
 * offsets from the primary's port (id 1 = basePort + 1, …), so an id means
 * the same process across server restarts and `list_instances` can rediscover
 * instances a previous server session launched.
 */
export class InstanceRegistry {
  private readonly host: string;
  private readonly basePort: number;
  private readonly token: string | undefined;
  private readonly maxInstances: number;
  private readonly exePath: string | undefined;
  private readonly log: (message: string) => void;
  private readonly records = new Map<number, InstanceRecord>();
  /** port → time it was released, for the TIME_WAIT cooldown. */
  private readonly cooldown = new Map<number, number>();
  /** Slots a launch() has claimed but not yet recorded. */
  private readonly reserved = new Set<number>();
  private activeId = 0;

  constructor(primary: C4DClient, options: InstanceRegistryOptions) {
    this.host = options.host;
    this.basePort = options.basePort;
    this.token = options.token;
    this.maxInstances = options.maxInstances ?? DEFAULT_MAX_INSTANCES;
    this.exePath = options.exePath;
    this.log = options.log ?? (() => {});
    this.records.set(0, {
      id: 0,
      port: options.basePort,
      managed: false,
      pid: null,
      child: null,
      client: primary,
      launchedAt: null,
      logPath: null,
      exit: null,
      spawnError: null,
    });
  }

  get active(): number {
    return this.activeId;
  }

  /** Client for `id`, or for the active instance when `id` is omitted. */
  clientFor(id?: number): C4DClient {
    const target = id ?? this.activeId;
    const rec = this.records.get(target);
    if (!rec) throw new Error(unknownInstance(target));
    return rec.client;
  }

  setActive(id: number): { active: number; port: number } {
    const rec = this.records.get(id);
    if (!rec) throw new Error(unknownInstance(id));
    this.activeId = id;
    return { active: id, port: rec.port };
  }

  async list(): Promise<InstanceInfo[]> {
    await this.discover();
    // Ids are small port offsets, so walking the slot range yields them in
    // order without sorting.
    const present: InstanceRecord[] = [];
    for (let id = 0; id < this.maxInstances; id++) {
      const rec = this.records.get(id);
      if (rec) present.push(rec);
    }
    return Promise.all(
      present.map(async (rec) => {
        const probe = await this.probe(rec);
        // A discovered (unmanaged) instance that stopped answering was closed
        // by whoever started it. Forget it; discover() picks it up again if
        // it comes back, and the slot frees up for launch_instance.
        if (probe.status === "unreachable" && !rec.managed && rec.id !== 0) {
          this.release(rec, `instance ${rec.id} (port ${rec.port}) is no longer reachable`);
        }
        return this.info(rec, probe.status, probe.version);
      }),
    );
  }

  async launch(options: {
    wait: boolean;
    timeoutMs: number;
  }): Promise<InstanceInfo & { waited_ms: number }> {
    const exe = resolveC4DExecutable(this.exePath);
    const id = this.allocateId();
    const port = this.basePort + id;
    // Hold the slot across the await so a concurrent launch picks another one.
    // Everything after it up to records.set() is synchronous.
    this.reserved.add(id);
    try {
      await assertPortFree(this.host, port);
    } finally {
      this.reserved.delete(id);
    }
    const logPath = path.join(os.tmpdir(), `mcp-cinema4d-instance-${port}.log`);
    // Inherit this server's environment so the token and every C4D_MCP_ENABLE_*
    // opt-in match on both sides; only the bridge endpoint differs.
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      C4D_MCP_HOST: this.host,
      C4D_MCP_PORT: String(port),
    };
    // g_allowParallelInstance is Cinema 4D's own switch for running a second
    // instance of the same installation; without it the new process forwards
    // its command line to the running one and exits. g_logfile keeps the
    // startup log where launch errors can be found.
    const args = ["g_allowParallelInstance=true", `g_logfile=${logPath}`];
    let child: ChildProcess;
    try {
      child = spawn(exe, args, {
        env,
        cwd: path.dirname(exe),
        // Detached so the instance survives this server restarting: a later
        // server session rediscovers it through list_instances.
        detached: true,
        stdio: "ignore",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`failed to start ${exe}: ${message}`, { cause: err });
    }
    child.unref();
    const rec: InstanceRecord = {
      id,
      port,
      managed: true,
      pid: child.pid ?? null,
      child,
      client: new C4DClient({ host: this.host, port, token: this.token }),
      launchedAt: Date.now(),
      logPath,
      exit: null,
      spawnError: null,
    };
    child.once("error", (err) => {
      rec.spawnError = err;
      this.release(rec, `instance ${id} failed to start: ${err.message}`);
    });
    child.once("exit", (code, signal) => {
      rec.exit = { code, signal };
      this.release(rec, `instance ${id} (pid ${rec.pid}) exited (code ${code}, signal ${signal})`);
    });
    this.records.set(id, rec);
    this.log(
      `launched instance ${id}: pid ${rec.pid}, bridge ${this.host}:${port}, log ${logPath}`,
    );

    const started = Date.now();
    if (!options.wait) {
      return { ...this.info(rec, "starting", null), waited_ms: 0 };
    }
    for (;;) {
      if (rec.spawnError) {
        throw new Error(`Cinema 4D failed to start (${exe}): ${rec.spawnError.message}`);
      }
      if (rec.exit) {
        throw new Error(
          `Cinema 4D exited before its bridge came up (exit code ${rec.exit.code}` +
            `${rec.exit.signal ? `, signal ${rec.exit.signal}` : ""}). ` +
            `Check the startup log at ${logPath} and the bridge log.`,
        );
      }
      const probe = await this.probe(rec);
      if (probe.status === "ready") {
        return { ...this.info(rec, "ready", probe.version), waited_ms: Date.now() - started };
      }
      if (Date.now() - started >= options.timeoutMs) {
        throw new Error(
          `instance ${id} (pid ${rec.pid}, port ${port}) did not answer within ${options.timeoutMs} ms. ` +
            `It keeps starting in the background: poll list_instances until it is ready, ` +
            `or stop_instance ${id} to abandon it. Startup log: ${logPath}`,
        );
      }
      await sleep(READY_POLL_MS);
    }
  }

  async stop(
    id: number,
    options: { force: boolean; timeoutMs: number },
  ): Promise<{ id: number; port: number; pid: number | null; stopped: true; method: string }> {
    if (id === 0) {
      throw new Error(
        "refusing to stop instance 0: it is the primary Cinema 4D this server was configured against (C4D_MCP_PORT). stop_instance only quits secondary instances.",
      );
    }
    const rec = this.records.get(id);
    if (!rec) throw new Error(unknownInstance(id));

    let method: "quit" | "kill" = "kill";
    if (!options.force) {
      try {
        await rec.client.request("quit", {}, 10_000);
        method = "quit";
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (!rec.managed) {
          throw new Error(
            `instance ${id} did not accept quit: ${message}. Only bridges launched with ` +
              `C4D_MCP_ENABLE_MULTIINSTANCE=1 in their environment (e.g. via launch_instance) ` +
              `accept it; pass force:true to terminate the process instead.`,
            { cause: err },
          );
        }
        this.log(`instance ${id} did not accept quit (${message}); terminating pid ${rec.pid}`);
      }
    }
    if (method === "kill") this.terminate(rec);

    let gone = await this.waitForExit(rec, options.timeoutMs);
    if (!gone && method === "quit") {
      // The bridge acknowledged but the process lingers (a modal dialog,
      // a plugin blocking shutdown). Managed or pid-known: finish the job.
      this.log(`instance ${id} still running ${options.timeoutMs} ms after quit; terminating`);
      this.terminate(rec);
      method = "kill";
      gone = await this.waitForExit(rec, KILL_GRACE_MS);
    }
    if (!gone) {
      throw new Error(`instance ${id} (pid ${rec.pid}) is still running after ${method}`);
    }
    if (this.records.has(id)) this.release(rec, `instance ${id} stopped (${method})`);
    return { id, port: rec.port, pid: rec.pid, stopped: true, method };
  }

  /** Drop every socket. Processes are left running on purpose. */
  closeAll(): void {
    for (const rec of this.records.values()) rec.client.close();
  }

  // ---------------------------------------------------------------------

  private info(rec: InstanceRecord, status: InstanceStatus, version: number | null): InstanceInfo {
    return {
      id: rec.id,
      port: rec.port,
      host: this.host,
      status,
      active: rec.id === this.activeId,
      managed: rec.managed,
      pid: rec.pid,
      c4d_version: version,
      log_path: rec.logPath,
      launched_at: rec.launchedAt === null ? null : new Date(rec.launchedAt).toISOString(),
    };
  }

  private async probe(
    rec: InstanceRecord,
  ): Promise<{ status: InstanceStatus; version: number | null }> {
    try {
      const reply = await rec.client.request<PingReply>("ping", {}, PROBE_REQUEST_TIMEOUT_MS);
      if (typeof reply?.pid === "number" && rec.pid === null) rec.pid = reply.pid;
      return {
        status: "ready",
        version: typeof reply?.c4d_version === "number" ? reply.c4d_version : null,
      };
    } catch {
      const starting =
        rec.managed &&
        rec.exit === null &&
        rec.launchedAt !== null &&
        Date.now() - rec.launchedAt < STARTING_GRACE_MS;
      return { status: starting ? "starting" : "unreachable", version: null };
    }
  }

  /** Register bridges already listening on the instance ports (launched by a previous server session, or by hand). */
  private async discover(): Promise<void> {
    const candidates: number[] = [];
    for (let id = 1; id < this.maxInstances; id++) {
      if (!this.records.has(id) && !this.reserved.has(id)) candidates.push(id);
    }
    await Promise.all(
      candidates.map(async (id) => {
        const port = this.basePort + id;
        const client = new C4DClient({
          host: this.host,
          port,
          token: this.token,
          connectTimeoutMs: PROBE_CONNECT_TIMEOUT_MS,
        });
        try {
          const reply = await client.request<PingReply>("ping", {}, PROBE_REQUEST_TIMEOUT_MS);
          if (!reply?.pong || this.records.has(id)) {
            client.close();
            return;
          }
          this.records.set(id, {
            id,
            port,
            managed: false,
            pid: typeof reply.pid === "number" ? reply.pid : null,
            child: null,
            client,
            launchedAt: null,
            logPath: null,
            exit: null,
            spawnError: null,
          });
          this.log(`discovered a bridge on ${this.host}:${port} as instance ${id}`);
        } catch {
          client.close();
        }
      }),
    );
  }

  private allocateId(): number {
    const free: number[] = [];
    for (let id = 1; id < this.maxInstances; id++) {
      if (!this.records.has(id) && !this.reserved.has(id)) free.push(id);
    }
    if (free.length === 0) {
      throw new Error(
        `all ${this.maxInstances} instance slots are in use (C4D_MCP_MAX_INSTANCES, primary included). stop_instance one first or raise the limit.`,
      );
    }
    const now = Date.now();
    const releasedAt = (id: number) => this.cooldown.get(this.basePort + id) ?? 0;
    const cool = free.filter((id) => now - releasedAt(id) > PORT_COOLDOWN_MS);
    if (cool.length > 0) return cool[0];
    // Every free port was released recently; take the one released longest ago.
    return free.reduce((oldest, id) => (releasedAt(id) < releasedAt(oldest) ? id : oldest));
  }

  private release(rec: InstanceRecord, message: string): void {
    rec.client.close();
    // A child can emit both "error" and "exit"; the later callback must not
    // drop a newer record that has since taken over the slot.
    if (this.records.get(rec.id) !== rec) return;
    this.records.delete(rec.id);
    this.cooldown.set(rec.port, Date.now());
    if (this.activeId === rec.id) this.activeId = 0;
    this.log(message);
  }

  private terminate(rec: InstanceRecord): void {
    if (rec.child) {
      try {
        rec.child.kill();
      } catch {
        /* already gone */
      }
      return;
    }
    if (rec.pid === null) {
      throw new Error(
        `instance ${rec.id} has no known pid to terminate (its bridge predates pid reporting); quit it from its own window.`,
      );
    }
    try {
      process.kill(rec.pid);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`could not terminate pid ${rec.pid}: ${message}`, { cause: err });
    }
  }

  private async waitForExit(rec: InstanceRecord, timeoutMs: number): Promise<boolean> {
    const started = Date.now();
    for (;;) {
      if (await this.hasExited(rec)) return true;
      if (Date.now() - started >= timeoutMs) return false;
      await sleep(500);
    }
  }

  private async hasExited(rec: InstanceRecord): Promise<boolean> {
    if (rec.child) return rec.exit !== null;
    // Unmanaged: gone once the bridge stops answering and the pid (if known) is dead.
    if (pidAlive(rec.pid)) return false;
    return (await this.probe(rec)).status !== "ready";
  }
}

function unknownInstance(id: number): string {
  return `unknown instance ${id}. Call list_instances to see which instances are reachable, or launch_instance to start one.`;
}

function pidAlive(pid: number | null): boolean {
  if (pid === null) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Cinema 4D executable used by launch_instance: C4D_MCP_EXE when set,
 * otherwise the newest install in the platform's default location. Never
 * taken from tool arguments — the LLM must not be able to pick the binary.
 */
export function resolveC4DExecutable(override?: string): string {
  if (override) {
    if (!existsSync(override)) {
      throw new Error(`C4D_MCP_EXE points to a missing file: ${override}`);
    }
    return override;
  }
  const found = findInstalledC4D();
  if (found.length === 0) {
    throw new Error(
      `no Cinema 4D installation found under ${defaultInstallRoot() ?? "(unsupported platform)"}; set C4D_MCP_EXE to the executable.`,
    );
  }
  return found[0];
}

function defaultInstallRoot(): string | null {
  if (process.platform === "win32") return process.env.ProgramFiles ?? "C:\\Program Files";
  if (process.platform === "darwin") return "/Applications";
  return null;
}

/** Installed executables, newest version first. */
export function findInstalledC4D(): string[] {
  const root = defaultInstallRoot();
  if (root === null) return [];
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return [];
  }
  const found: Array<{ version: number[]; exe: string }> = [];
  for (const name of entries) {
    const match = /^Maxon Cinema 4D (\d{4}(?:\.\d+)*)$/i.exec(name);
    if (!match) continue;
    const exe =
      process.platform === "win32"
        ? path.join(root, name, "Cinema 4D.exe")
        : path.join(root, name, "Cinema 4D.app", "Contents", "MacOS", "Cinema 4D");
    if (existsSync(exe)) found.push({ version: match[1].split(".").map(Number), exe });
  }
  found.sort((a, b) => compareVersions(b.version, a.version));
  return found.map((f) => f.exe);
}

function compareVersions(a: number[], b: number[]): number {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function assertPortFree(host: string, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", (err: NodeJS.ErrnoException) => {
      reject(
        new Error(
          `port ${port} on ${host} is already in use (${err.code ?? err.message}); another process owns it. list_instances registers bridges it can reach — anything else must be freed by hand.`,
        ),
      );
    });
    server.listen(port, host, () => {
      server.close(() => resolve());
    });
  });
}
