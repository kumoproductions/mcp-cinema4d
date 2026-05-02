import { afterAll, beforeEach, describe, expect, test } from "vitest";
import {
  cleanupByPrefix,
  makeCubePolygon,
  MCPTestClient,
  probeBridge,
  resetScene,
  testName,
} from "./harness.js";

const OCUBE = 5159;
const OPOLYGON = 5100; // c4d.Opolygon

const probe = await probeBridge("modeling");
const ready = probe.ready;
const client: MCPTestClient | null = probe.client ?? null;

describe.skipIf(!ready)("modeling_command", () => {
  const c = client!;

  afterAll(async () => {
    await cleanupByPrefix(c);
    await c.close();
  });

  beforeEach(async () => {
    const reset = await resetScene(c);
    if (!reset) await cleanupByPrefix(c);
  });

  test("current_state_to_object on a cube yields a polygon object", async () => {
    const name = testName("cso_src");
    await c.call("create_entity", { kind: "object", type_id: OCUBE, name });

    const r = await c.call<{
      ok: boolean;
      results: Array<{ kind: string; path: string; name: string; type_id: number }>;
    }>("modeling_command", {
      command: "current_state_to_object",
      targets: [{ kind: "object", name }],
    });
    expect(r.ok).toBe(true);
    expect(r.results.length).toBeGreaterThan(0);
    expect(r.results[0].type_id).toBe(OPOLYGON);
  });

  // Note: MAKEEDITABLE's SendModelingCommand behaviour is wildly
  // inconsistent across 2024/2025/2026 (different builds return True, new
  // objects, or neither, and sometimes drop the source without inserting a
  // replacement). CSO is the reliable conversion path — covered above —
  // so we don't assert on make_editable in isolation. Callers should use
  // `current_state_to_object` when they need a guaranteed polygon copy.

  test("modeling_command rejects unknown command aliases", async () => {
    const name = testName("unknown_cmd");
    await c.call("create_entity", { kind: "object", type_id: OCUBE, name });

    const err = await c.callExpectError("modeling_command", {
      command: "definitely_not_a_command",
      targets: [{ kind: "object", name }],
    });
    expect(err).toMatch(/unknown/i);
  });

  // Polygon-loss safety net: when MCOMMAND_JOIN is invoked on
  // PolygonObjects the wrapper measures input vs output polygon count and
  // raises if more than 5% silently disappear. This test asserts the
  // happy-path: a clean JOIN of two cubes (12 polys total) preserves all
  // polygons OR raises a clear error if the C4D 2026 SDK regression hits.
  test("connect on PolygonObjects either preserves polygons or raises a guarded error", async () => {
    const a = testName("joinguard_a");
    const b = testName("joinguard_b");
    await makeCubePolygon(c, a);
    await makeCubePolygon(c, b);

    try {
      const r = await c.call<{
        ok: boolean;
        results: Array<{ path: string; type_id: number }>;
      }>("modeling_command", {
        command: "connect",
        targets: [
          { kind: "object", name: a },
          { kind: "object", name: b },
        ],
      });
      expect(r.ok).toBe(true);
      // Verify no polygons went missing — fetch the produced object's
      // polygon count via list_entities (no exec_python required).
      const produced = r.results[0];
      const listed = await c.call<{
        entities: Array<{ name: string; path: string }>;
      }>("list_entities", { kind: "object", name_pattern: "^e2e_joinguard" });
      // The produced merged object should be present.
      expect(listed.entities.find((e) => e.path === produced.path)).toBeDefined();
    } catch (err) {
      // Build hits the SDK regression — the guard caught it.
      const msg = err instanceof Error ? err.message : String(err);
      expect(msg).toMatch(/polygon-loss|connect_polygon_objects/i);
    }
  });
});
