import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SERVER_ENTRY = path.join(REPO_ROOT, "dist", "index.js");

export const TEST_PREFIX = "e2e_";

function ensureBuilt(): void {
  if (existsSync(SERVER_ENTRY)) return;
  const r = spawnSync("npm", ["run", "build"], { cwd: REPO_ROOT, stdio: "inherit", shell: true });
  if (r.status !== 0) {
    throw new Error("failed to build MCP server before tests");
  }
}

/** Thin MCP client wrapper that returns JSON-parsed tool results. */
export class MCPTestClient {
  private client: Client;
  private transport: StdioClientTransport | null = null;

  constructor() {
    this.client = new Client({ name: "cinema4d-mcp-e2e", version: "0.0.1" }, { capabilities: {} });
  }

  async connect(): Promise<void> {
    ensureBuilt();
    this.transport = new StdioClientTransport({
      command: process.execPath, // current Node binary
      args: [SERVER_ENTRY],
      // Let the bridge host/port flow through from the shell env.
      env: { ...process.env } as Record<string, string>,
    });
    await this.client.connect(this.transport);
  }

  async close(): Promise<void> {
    try {
      await this.client.close();
    } catch {
      /* ignore */
    }
    this.transport = null;
  }

  async call<T = unknown>(
    name: string,
    args: Record<string, unknown> = {},
    options: { timeoutMs?: number } = {},
  ): Promise<T> {
    const res = await this.client.callTool(
      { name, arguments: args },
      undefined,
      options.timeoutMs !== undefined ? { timeout: options.timeoutMs } : undefined,
    );
    const text = extractText(res);
    if (res.isError) {
      throw new Error(`tool ${name} returned error: ${text}`);
    }
    if (!text) return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch (err) {
      throw new Error(`tool ${name} returned non-JSON text: ${text}`, { cause: err });
    }
  }

  /** Like call() but returns the raw error message instead of throwing. */
  async callExpectError(name: string, args: Record<string, unknown> = {}): Promise<string> {
    const res = await this.client.callTool({ name, arguments: args });
    if (!res.isError) {
      throw new Error(`expected tool ${name} to error, got ok: ${extractText(res)}`);
    }
    return extractText(res);
  }
}

function extractText(res: any): string {
  const content = res?.content;
  if (!Array.isArray(content) || content.length === 0) return "";
  const first = content[0];
  return typeof first?.text === "string" ? first.text : "";
}

/** Connect, ping the bridge. Returns true if C4D + plugin are reachable. */
export async function probeBridge(suite: string): Promise<{
  ready: boolean;
  reason?: string;
  client?: MCPTestClient;
}> {
  const client = new MCPTestClient();
  try {
    await client.connect();
    const pong = await client.call<{ pong: boolean }>("ping", {});
    if (!pong?.pong) {
      await client.close();
      printSkipBanner(suite, "ping returned unexpected payload");
      return { ready: false, reason: "ping returned unexpected payload" };
    }
    return { ready: true, client };
  } catch (err) {
    await client.close();
    const reason = err instanceof Error ? err.message : String(err);
    printSkipBanner(suite, reason);
    return { ready: false, reason };
  }
}

function printSkipBanner(suite: string, reason: string): void {
  const host = process.env.C4D_MCP_HOST ?? process.env.C4D_BRIDGE_HOST ?? "127.0.0.1";
  const port = process.env.C4D_MCP_PORT ?? process.env.C4D_BRIDGE_PORT ?? "18710";
  // Visible banner so skips are not confused with success.
  const divider = "─".repeat(72);
  console.warn(
    [
      divider,
      `[e2e ${suite}] SKIPPING — Cinema 4D bridge not reachable`,
      ` reason : ${reason}`,
      ` target : ${host}:${port}`,
      " ",
      " To run these tests:",
      "   1. Launch Cinema 4D.",
      "   2. Install the bridge plugin (symlink `plugin/cinema4d_mcp_bridge/` into the plugins folder, then restart C4D).",
      "   3. Confirm C4D console prints `[cinema4d_mcp_bridge] listening on ...`.",
      "   4. Re-run `npm test`.",
      divider,
    ].join("\n"),
  );
}

/**
 * Reset for tests: swap in a fresh empty BaseDocument via `new_document`.
 *
 * Why a full document swap instead of prefix-scoped cleanup? C4D 2026
 * occasionally stalls its CoreMessage pump after a mix of set_mesh +
 * obj.Remove() operations on the same doc — the bridge's command queue
 * drains, then the main thread never processes the next SpecialEventAdd.
 * Swapping the active document sidesteps that entirely: no per-object
 * Remove loop is needed, and the previous doc's undo buffer is gone
 * along with it.
 *
 * `new_document` is a boring, well-tested call on the bridge. If it
 * fails (really old bridge), we fall back to exec_python and then to
 * prefix cleanup.
 */
export async function resetScene(client: MCPTestClient): Promise<boolean> {
  try {
    await client.call("new_document", { make_active: true });
    return true;
  } catch {
    /* fall through to exec_python */
  }
  try {
    await client.call("exec_python", {
      code: `
import c4d
from c4d import documents
doc = documents.GetActiveDocument()
if doc is not None:
    obj = doc.GetFirstObject()
    while obj is not None:
        nxt = obj.GetNext()
        obj.Remove()
        obj = nxt
    mat = doc.GetFirstMaterial()
    while mat is not None:
        nxt = mat.GetNext()
        mat.Remove()
        mat = nxt
    active_rd = doc.GetActiveRenderData()
    rd = doc.GetFirstRenderData()
    while rd is not None:
        nxt = rd.GetNext()
        if rd is not active_rd:
            rd.Remove()
        rd = nxt
    td = doc.GetTakeData()
    if td is not None:
        def _drop_children(parent):
            c = parent.GetDown()
            while c is not None:
                nxt = c.GetNext()
                _drop_children(c)
                td.DeleteTake(c)
                c = nxt
        _drop_children(td.GetMainTake())
        td.SetCurrentTake(td.GetMainTake())
    c4d.EventAdd()
result = {"ok": True}
`.trim(),
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Remove every test-prefixed entity we know how to address. Safe fallback
 * when `exec_python` is disabled. Objects, materials, render data (except
 * the active one — removing that would invalidate the doc), layers,
 * non-main takes.
 *
 * Sequential on purpose: Cinema 4D dispatches on a single main thread, so
 * parallel removes would queue up on the bridge and risk racing each
 * other's handle resolution.
 */
export async function cleanupByPrefix(client: MCPTestClient): Promise<void> {
  const pattern = `^${TEST_PREFIX}`;

  async function cleanupObjects(): Promise<void> {
    try {
      const listed = await client.call<{ entities: Array<{ name: string; path: string }> }>(
        "list_entities",
        { kind: "object", name_pattern: pattern },
      );
      for (const e of listed.entities ?? []) {
        await client.call("remove_entity", {
          handle: { kind: "object", path: e.path ?? undefined, name: e.name },
        });
      }
    } catch {
      /* best-effort */
    }
  }

  async function cleanupMaterials(): Promise<void> {
    try {
      const listed = await client.call<{ entities: Array<{ name: string }> }>("list_entities", {
        kind: "material",
        name_pattern: pattern,
      });
      for (const e of listed.entities ?? []) {
        await client.call("remove_entity", { handle: { kind: "material", name: e.name } });
      }
    } catch {
      /* best-effort */
    }
  }

  async function cleanupRenderData(): Promise<void> {
    try {
      const listed = await client.call<{
        entities: Array<{ name: string; is_active?: boolean }>;
      }>("list_entities", { kind: "render_data", name_pattern: pattern });
      for (const e of listed.entities ?? []) {
        if (e.is_active) continue; // dropping the active RD invalidates the doc
        await client.call("remove_entity", { handle: { kind: "render_data", name: e.name } });
      }
    } catch {
      /* best-effort */
    }
  }

  await cleanupObjects();
  await cleanupMaterials();
  await cleanupRenderData();
}

export function testName(base: string): string {
  return `${TEST_PREFIX}${base}`;
}
