import { afterAll, describe, expect, test } from "vitest";
import { MCPTestClient, probeBridge, resetScene, testName } from "./harness.js";

const OCUBE = 5159;
const FLAG = "C4D_MCP_ENABLE_MULTIINSTANCE";
const INSTANCE_TOOLS = [
  "list_instances",
  "set_active_instance",
  "launch_instance",
  "stop_instance",
];

const multiEnabled = /^(1|true|yes|on)$/i.test((process.env[FLAG] ?? "").trim());

function schemaKeys(tool: { inputSchema: Record<string, unknown> } | undefined): string[] {
  const props = tool?.inputSchema.properties;
  return props && typeof props === "object" ? Object.keys(props as object) : [];
}

// ---------------------------------------------------------------------------
// Gate — decided by the MCP server alone, so this part needs no Cinema 4D.
// ---------------------------------------------------------------------------

describe("multi-instance gate", () => {
  test("instance tools and the `instance` argument are absent without the flag", async () => {
    const c = new MCPTestClient();
    await c.connect({ [FLAG]: undefined });
    try {
      const tools = await c.listTools();
      const names = tools.map((t) => t.name);
      for (const name of INSTANCE_TOOLS) expect(names).not.toContain(name);
      const ping = tools.find((t) => t.name === "ping");
      expect(ping).toBeDefined();
      expect(schemaKeys(ping)).not.toContain("instance");
    } finally {
      await c.close();
    }
  });

  test("instance tools and the `instance` argument appear with the flag", async () => {
    const c = new MCPTestClient();
    await c.connect({ [FLAG]: "1" });
    try {
      const tools = await c.listTools();
      const names = tools.map((t) => t.name);
      for (const name of INSTANCE_TOOLS) expect(names).toContain(name);
      // Scene tools are routed, the instance tools themselves are not.
      expect(schemaKeys(tools.find((t) => t.name === "ping"))).toContain("instance");
      expect(schemaKeys(tools.find((t) => t.name === "batch"))).toContain("instance");
      expect(schemaKeys(tools.find((t) => t.name === "list_instances"))).not.toContain("instance");
    } finally {
      await c.close();
    }
  });
});

// ---------------------------------------------------------------------------
// Live — needs the flag in the shell env (the harness passes it to the
// server) and a running primary Cinema 4D. Launches a second Cinema 4D, so
// budget a couple of minutes and several GB of RAM.
// ---------------------------------------------------------------------------

const probe = multiEnabled ? await probeBridge("instances") : null;
const ready = probe?.ready ?? false;
const client: MCPTestClient | null = probe?.client ?? null;

describe.skipIf(!ready)(`multi-instance (${FLAG}=1)`, () => {
  const c = client!;
  const isoName = testName("iso_cube");
  let launched: number | null = null;
  let primaryPid: number | null = null;

  afterAll(async () => {
    if (launched !== null) {
      try {
        await c.call("stop_instance", { id: launched, force: true }, { timeoutMs: 60_000 });
      } catch {
        /* best-effort: the process may already be gone */
      }
    }
    await c.close();
  });

  test("list_instances reports the primary as instance 0 and active", async () => {
    const r = await c.call<{
      active: number;
      instances: Array<{
        id: number;
        status: string;
        active: boolean;
        managed: boolean;
        pid: number | null;
      }>;
    }>("list_instances");
    expect(r.active).toBe(0);
    const primary = r.instances.find((i) => i.id === 0);
    expect(primary).toBeDefined();
    expect(primary!.status).toBe("ready");
    expect(primary!.active).toBe(true);
    expect(primary!.managed).toBe(false);
    primaryPid = primary!.pid;
  });

  test("stop_instance refuses the primary", async () => {
    const err = await c.callExpectError("stop_instance", { id: 0 });
    // Either zod's min(1) or the registry's own refusal — both must hold the line.
    expect(err).toMatch(/instance 0|primary|>=1|greater than or equal to 1/i);
  });

  test("launch_instance starts a second Cinema 4D with its own bridge", async () => {
    const r = await c.call<{
      id: number;
      port: number;
      pid: number | null;
      status: string;
      managed: boolean;
    }>("launch_instance", { timeout_ms: 300_000 }, { timeoutMs: 320_000 });
    expect(r.status).toBe("ready");
    expect(r.id).toBeGreaterThan(0);
    expect(r.managed).toBe(true);
    launched = r.id;

    const pong = await c.call<{ pong: boolean; pid?: number }>("ping", { instance: r.id });
    expect(pong.pong).toBe(true);
    if (typeof pong.pid === "number" && primaryPid !== null) {
      expect(pong.pid).not.toBe(primaryPid);
    }
  }, 330_000);

  test("scene edits in one instance do not show up in the other", async () => {
    expect(launched).not.toBeNull();
    await resetScene(c);
    await c.call("new_document", { make_active: true, instance: launched });
    await c.call("create_entity", {
      kind: "object",
      type_id: OCUBE,
      name: isoName,
      instance: launched,
    });
    const pattern = `^${isoName}$`;
    const secondary = await c.call<{ entities: unknown[] }>("list_entities", {
      kind: "object",
      name_pattern: pattern,
      instance: launched,
    });
    expect(secondary.entities.length).toBe(1);
    const primary = await c.call<{ entities: unknown[] }>("list_entities", {
      kind: "object",
      name_pattern: pattern,
    });
    expect(primary.entities.length).toBe(0);
  });

  test("set_active_instance redirects calls that omit `instance`", async () => {
    expect(launched).not.toBeNull();
    await c.call("set_active_instance", { id: launched });
    try {
      const r = await c.call<{ active: number }>("list_instances");
      expect(r.active).toBe(launched);
      const seen = await c.call<{ entities: unknown[] }>("list_entities", {
        kind: "object",
        name_pattern: `^${isoName}$`,
      });
      expect(seen.entities.length).toBe(1);
    } finally {
      await c.call("set_active_instance", { id: 0 });
    }
  });

  test("stop_instance quits the launched instance", async () => {
    expect(launched).not.toBeNull();
    const id = launched!;
    const r = await c.call<{ stopped: boolean; method: string }>(
      "stop_instance",
      { id },
      { timeoutMs: 90_000 },
    );
    expect(r.stopped).toBe(true);
    expect(r.method).toBe("quit");
    launched = null;
    const list = await c.call<{ instances: Array<{ id: number }> }>("list_instances");
    expect(list.instances.some((i) => i.id === id)).toBe(false);
  }, 120_000);
});
