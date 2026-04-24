import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { cleanupByPrefix, MCPTestClient, probeBridge, resetScene } from "./harness.js";

// Alembic exporter option IDs (stable since R20+).
const ABCEXPORT_FRAME_START = 1001;
const ABCEXPORT_FRAME_END = 1002;
const ABCEXPORT_FRAME_STEP = 1003;
const ABCEXPORT_SUBFRAMES = 1004;
const ABCEXPORT_CAMERAS = 1012;
const ABCEXPORT_VISIBILITY = 1007;

const probe = await probeBridge("plugin_options");
const ready = probe.ready;
const client: MCPTestClient | null = probe.client ?? null;

describe.skipIf(!ready)("plugin_options handle", () => {
  const c = client!;

  afterAll(async () => {
    await cleanupByPrefix(c);
    await c.close();
  });

  beforeEach(async () => {
    const reset = await resetScene(c);
    if (!reset) await cleanupByPrefix(c);
  });

  test("describe returns the Alembic exporter's settings schema", async () => {
    const d = await c.call<{
      summary: { name: string; type_id: number };
      params: Array<{ id: number; name: string; dtype_name: string }>;
    }>("describe", {
      handle: { kind: "plugin_options", plugin_id: "abc" },
    });
    // Exporter plugin id for Alembic is stable.
    expect(d.summary.type_id).toBe(1028082);
    expect(d.summary.name).toMatch(/alembic/i);
    // Frame-range + Cameras + Subframes should always appear in the schema.
    const ids = new Set(d.params.map((p) => p.id));
    for (const required of [
      ABCEXPORT_FRAME_START,
      ABCEXPORT_FRAME_END,
      ABCEXPORT_FRAME_STEP,
      ABCEXPORT_SUBFRAMES,
      ABCEXPORT_CAMERAS,
    ]) {
      expect(ids.has(required)).toBe(true);
    }
  });

  test("set_params + get_params round-trip on exporter options", async () => {
    const h = { kind: "plugin_options" as const, plugin_id: "abc" };

    const applied = await c.call<{
      applied: Array<{ path: number[]; value: number | boolean }>;
      errors: Array<unknown>;
    }>("set_params", {
      handle: h,
      values: [
        { path: ABCEXPORT_FRAME_START, value: 0 },
        { path: ABCEXPORT_FRAME_END, value: 240 },
        { path: ABCEXPORT_FRAME_STEP, value: 1 },
        { path: ABCEXPORT_SUBFRAMES, value: 1 },
        { path: ABCEXPORT_CAMERAS, value: true },
        { path: ABCEXPORT_VISIBILITY, value: true },
      ],
    });
    expect(applied.errors).toEqual([]);
    expect(applied.applied.length).toBe(6);

    const read = await c.call<{
      values: Array<{ path: number[]; value: number | boolean }>;
    }>("get_params", {
      handle: h,
      ids: [
        ABCEXPORT_FRAME_START,
        ABCEXPORT_FRAME_END,
        ABCEXPORT_FRAME_STEP,
        ABCEXPORT_SUBFRAMES,
        ABCEXPORT_CAMERAS,
        ABCEXPORT_VISIBILITY,
      ],
    });
    // Values come back as-written. Booleans round-trip as 0/1 because the
    // underlying BaseList2D stores DTYPE_BOOL as int.
    expect(read.values[0].value).toBe(0);
    expect(read.values[1].value).toBe(240);
    expect(read.values[2].value).toBe(1);
    expect(read.values[3].value).toBe(1);
    expect(Number(read.values[4].value)).toBe(1);
    expect(Number(read.values[5].value)).toBe(1);
  });

  test("numeric plugin_id resolves the same exporter as the alias", async () => {
    // Plugin id 1028082 = FORMAT_ABCEXPORT. Callers can skip the alias and
    // pass the int when they already know it (e.g. third-party exporters
    // that don't have an alias registered yet).
    const viaAlias = await c.call<{ summary: { type_id: number } }>("describe", {
      handle: { kind: "plugin_options", plugin_id: "abc" },
    });
    const viaInt = await c.call<{ summary: { type_id: number } }>("describe", {
      handle: { kind: "plugin_options", plugin_id: 1028082, plugin_type: "scene_saver" },
    });
    expect(viaInt.summary.type_id).toBe(viaAlias.summary.type_id);
  });

  test("unknown plugin_id raises a structured 'handle not resolved' error", async () => {
    // Bogus plugin id the resolver can't locate. FindPlugin returns None so
    // _resolve_handle returns None, and the downstream handler raises with
    // "handle not resolved". Structured so callers can distinguish from
    // "plugin found but option write failed".
    const err = await c.callExpectError("describe", {
      handle: { kind: "plugin_options", plugin_id: 99999999 },
    });
    expect(err).toMatch(/handle not resolved/i);
  });
});
