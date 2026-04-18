import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { cleanupByPrefix, MCPTestClient, probeBridge, resetScene, testName } from "./harness.js";

const OCUBE = 5159;
const OPOLYGON = 5100;

const probe = await probeBridge("mesh");
const ready = probe.ready;
const client: MCPTestClient | null = probe.client ?? null;

describe.skipIf(!ready)("mesh (get/set)", () => {
  const c = client!;

  afterAll(async () => {
    await cleanupByPrefix(c);
    await c.close();
  });

  beforeEach(async () => {
    const reset = await resetScene(c);
    if (!reset) await cleanupByPrefix(c);
  });

  test("get_mesh round-trips points/polygons on a hand-built PolygonObject", async () => {
    // Skip modeling_command → the make_editable / current_state_to_object
    // return shape varies too much across 2024/2025/2026 to assert on
    // reliably. Build a polygon object directly via set_mesh, then read
    // it back with get_mesh — that's the round-trip our mesh tools
    // actually promise.
    const name = testName("mesh_cube");
    await c.call("create_entity", { kind: "object", type_id: OPOLYGON, name });

    // Seed with 8 points + 6 quad faces (unit cube topology).
    const points = [
      [-100, -100, -100],
      [100, -100, -100],
      [100, 100, -100],
      [-100, 100, -100],
      [-100, -100, 100],
      [100, -100, 100],
      [100, 100, 100],
      [-100, 100, 100],
    ];
    const polygons = [
      [0, 1, 2, 3],
      [4, 7, 6, 5],
      [0, 4, 5, 1],
      [1, 5, 6, 2],
      [2, 6, 7, 3],
      [3, 7, 4, 0],
    ];
    await c.call("set_mesh", {
      handle: { kind: "object", name },
      points,
      polygons,
    });

    const r = await c.call<{
      type: string;
      point_count: number;
      polygon_count: number;
      points: number[][];
      polygons: number[][];
    }>("get_mesh", { handle: { kind: "object", name } });
    expect(r.type).toBe("polygon");
    expect(r.point_count).toBe(8);
    expect(r.polygon_count).toBe(6);
    expect(r.points.length).toBe(8);
    expect(r.polygons.length).toBe(6);
    expect(r.points[0].length).toBe(3);
  });

  test("get_mesh rejects a non-editable primitive", async () => {
    const name = testName("mesh_primitive");
    await c.call("create_entity", { kind: "object", type_id: OCUBE, name });
    const err = await c.callExpectError("get_mesh", { handle: { kind: "object", name } });
    expect(err).toMatch(/editable|make_editable|PointObject/i);
  });

  test("set_mesh replaces points and polygons on a fresh polygon object", async () => {
    const name = testName("mesh_set");
    // Create an empty polygon object directly.
    await c.call("create_entity", { kind: "object", type_id: OPOLYGON, name });

    const points = [
      [0, 0, 0],
      [100, 0, 0],
      [100, 100, 0],
      [0, 100, 0],
    ];
    const polygons = [[0, 1, 2, 3]];
    const r = await c.call<{ point_count: number; polygon_count: number }>("set_mesh", {
      handle: { kind: "object", name },
      points,
      polygons,
    });
    expect(r.point_count).toBe(4);
    expect(r.polygon_count).toBe(1);

    const got = await c.call<{ points: number[][]; polygons: number[][] }>("get_mesh", {
      handle: { kind: "object", name },
    });
    expect(got.points).toEqual(points);
    expect(got.polygons[0]).toEqual([0, 1, 2, 3]);
  });

  test("set_mesh_selection + get_mesh include:['selections'] round-trip", async () => {
    const name = testName("mesh_sel");
    await c.call("create_entity", { kind: "object", type_id: OPOLYGON, name });
    await c.call("set_mesh", {
      handle: { kind: "object", name },
      points: [
        [0, 0, 0],
        [100, 0, 0],
        [100, 100, 0],
        [0, 100, 0],
        [0, 0, 100],
        [100, 0, 100],
      ],
      polygons: [
        [0, 1, 2, 3],
        [0, 4, 5, 1],
      ],
    });

    await c.call("set_mesh_selection", {
      handle: { kind: "object", name },
      kind: "polygon",
      indices: [1],
    });
    await c.call("set_mesh_selection", {
      handle: { kind: "object", name },
      kind: "point",
      indices: [0, 2, 4],
    });

    const r = await c.call<{
      poly_selection?: number[];
      point_selection?: number[];
    }>("get_mesh", {
      handle: { kind: "object", name },
      include: ["selections"],
    });
    expect(r.poly_selection).toEqual([1]);
    expect((r.point_selection ?? []).toSorted((a, b) => a - b)).toEqual([0, 2, 4]);
  });

  test("set_mesh accepts triangles (same a-b-c with d repeated as c)", async () => {
    const name = testName("mesh_tri");
    await c.call("create_entity", { kind: "object", type_id: OPOLYGON, name });

    const points = [
      [0, 0, 0],
      [100, 0, 0],
      [50, 100, 0],
    ];
    const polygons = [[0, 1, 2]]; // triangle — bridge must expand to (0,1,2,2)
    const r = await c.call<{ point_count: number; polygon_count: number }>("set_mesh", {
      handle: { kind: "object", name },
      points,
      polygons,
    });
    expect(r.point_count).toBe(3);
    expect(r.polygon_count).toBe(1);
  });
});
