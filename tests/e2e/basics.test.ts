import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { cleanupByPrefix, MCPTestClient, probeBridge, resetScene, testName } from "./harness.js";

const probe = await probeBridge("basics");
const ready = probe.ready;
const client: MCPTestClient | null = probe.client ?? null;

describe.skipIf(!ready)("basics", () => {
  const c = client!;

  afterAll(async () => {
    await cleanupByPrefix(c);
    await c.close();
  });

  beforeEach(async () => {
    const reset = await resetScene(c);
    if (!reset) await cleanupByPrefix(c);
  });

  test("ping returns pong + c4d version", async () => {
    const r = await c.call<{ pong: boolean; c4d_version: number }>("ping");
    expect(r.pong).toBe(true);
    expect(typeof r.c4d_version).toBe("number");
    expect(r.c4d_version).toBeGreaterThan(0);
  });

  test("list_entities kind=object returns no e2e_ objects after cleanup", async () => {
    // We can't assume a fully empty doc — the user may be running tests
    // alongside their own scene. Scope the assertion to our own prefix so
    // this test is stable regardless of surrounding content.
    const r = await c.call<{ entities: Array<{ name: string }> }>("list_entities", {
      kind: "object",
      name_pattern: "^e2e_",
    });
    expect(Array.isArray(r.entities)).toBe(true);
    expect(r.entities.length).toBe(0);
  });

  test("create_entity with string alias places a cube findable via list_entities", async () => {
    const name = testName("cube");
    const created = await c.call<{
      handle: { kind: string; name: string; path: string };
      summary: { path: string };
    }>("create_entity", { kind: "object", type_id: "cube", name, position: [10, 20, 30] });
    expect(created.handle.name).toBe(name);
    expect(created.handle.path).toBe(`/${name}`);

    const listed = await c.call<{ entities: Array<{ name: string }> }>("list_entities", {
      kind: "object",
      name_pattern: `^${name}$`,
    });
    expect(listed.entities.map((o) => o.name)).toContain(name);
  });

  test("render produces a file at the returned path", async () => {
    // Shrink the active render data so the smoke-test render is cheap.
    // RDATA_XRES=1000, RDATA_YRES=1001.
    const listed = await c.call<{ entities: Array<{ name: string; is_active: boolean }> }>(
      "list_entities",
      { kind: "render_data" },
    );
    const active = listed.entities.find((e) => e.is_active);
    if (active) {
      await c.call("set_params", {
        handle: { kind: "render_data", name: active.name },
        values: [
          { path: 1000, value: 64 },
          { path: 1001, value: 64 },
        ],
      });
    }
    await c.call("create_entity", {
      kind: "object",
      type_id: "cube",
      name: testName("render_target"),
    });
    const r = await c.call<{ path: string; width: number; height: number }>(
      "render",
      {},
      { timeoutMs: 120_000 },
    );
    expect(typeof r.path).toBe("string");
    const { existsSync, statSync } = await import("node:fs");
    expect(existsSync(r.path)).toBe(true);
    expect(statSync(r.path).size).toBeGreaterThan(0);
  });
});
