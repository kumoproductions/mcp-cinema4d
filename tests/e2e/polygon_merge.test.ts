import { afterAll, beforeEach, describe, expect, test } from "vitest";
import {
  cleanupByPrefix,
  makeCubePolygon as makePoly,
  MCPTestClient,
  probeBridge,
  resetScene,
  testName,
} from "./harness.js";

const OPOLYGON = 5100;
const ONULL = 5140;

const probe = await probeBridge("polygon_merge");
const ready = probe.ready;
const client: MCPTestClient | null = probe.client ?? null;

describe.skipIf(!ready)("connect_polygon_objects", () => {
  const c = client!;

  afterAll(async () => {
    await cleanupByPrefix(c);
    await c.close();
  });

  beforeEach(async () => {
    const reset = await resetScene(c);
    if (!reset) await cleanupByPrefix(c);
  });

  test("merges three PolygonObjects without losing polygons", async () => {
    const a = testName("cpo_a");
    const b = testName("cpo_b");
    const d = testName("cpo_c");
    await makePoly(c, a);
    await makePoly(c, b);
    await makePoly(c, d);

    const r = await c.call<{
      ok: boolean;
      polys_in: number;
      polys_out: number;
      points_in: number;
      points_out: number;
      merged: { handle: { path: string; name: string }; polygon_count: number };
      originals_deleted: boolean;
      merged_count: number;
    }>("connect_polygon_objects", {
      objects: [
        { kind: "object", name: a },
        { kind: "object", name: b },
        { kind: "object", name: d },
      ],
    });

    expect(r.ok).toBe(true);
    expect(r.merged_count).toBe(3);
    expect(r.polys_in).toBe(18); // 3 cubes * 6 faces
    expect(r.polys_out).toBe(r.polys_in);
    expect(r.points_out).toBe(r.points_in);
    expect(r.merged.polygon_count).toBe(18);
    expect(r.originals_deleted).toBe(true);
  });

  test("delete_originals=false keeps source objects intact", async () => {
    const a = testName("cpo_keep_a");
    const b = testName("cpo_keep_b");
    await makePoly(c, a);
    await makePoly(c, b);

    const r = await c.call<{ polys_out: number; originals_deleted: boolean }>(
      "connect_polygon_objects",
      {
        objects: [
          { kind: "object", name: a },
          { kind: "object", name: b },
        ],
        delete_originals: false,
      },
    );
    expect(r.polys_out).toBe(12);
    expect(r.originals_deleted).toBe(false);

    const remaining = await c.call<{ entities: Array<{ name: string }> }>("list_entities", {
      kind: "object",
      name_pattern: "^e2e_cpo_keep_",
    });
    const names = remaining.entities.map((e) => e.name);
    expect(names).toContain(a);
    expect(names).toContain(b);
  });

  test("rejects fewer than 2 objects", async () => {
    const a = testName("cpo_solo");
    await makePoly(c, a);
    const err = await c.callExpectError("connect_polygon_objects", {
      objects: [{ kind: "object", name: a }],
    });
    // The validation can come from zod (TS) or the Python handler.
    expect(err).toMatch(/(>= ?2|at least 2|too_small|min)/i);
  });

  test("rejects non-PolygonObject inputs with a clear message", async () => {
    const nullA = testName("cpo_null_a");
    const nullB = testName("cpo_null_b");
    await c.call("create_entity", { kind: "object", type_id: ONULL, name: nullA });
    await c.call("create_entity", { kind: "object", type_id: ONULL, name: nullB });

    const err = await c.callExpectError("connect_polygon_objects", {
      objects: [
        { kind: "object", name: nullA },
        { kind: "object", name: nullB },
      ],
    });
    expect(err).toMatch(/PolygonObject/);
  });

  test("places the merged result under target_parent when given", async () => {
    const a = testName("cpo_p_a");
    const b = testName("cpo_p_b");
    const host = testName("cpo_p_host");
    await makePoly(c, a);
    await makePoly(c, b);
    await c.call("create_entity", { kind: "object", type_id: ONULL, name: host });

    const r = await c.call<{
      merged: { handle: { path: string; name: string } };
    }>("connect_polygon_objects", {
      objects: [
        { kind: "object", name: a },
        { kind: "object", name: b },
      ],
      target_parent: { kind: "object", name: host },
      target_name: testName("cpo_p_merged"),
    });
    expect(r.merged.handle.path.startsWith(`/${host}/`)).toBe(true);
    expect(r.merged.handle.name).toBe(testName("cpo_p_merged"));
  });

  // When source PolygonObjects sit under different transformed parents,
  // merging without a world-space transform would collapse them onto each
  // other. Verify the merged geometry occupies a bounding box wide enough
  // to contain both source cubes' world positions.
  test("preserves world position when sources sit under different parents", async () => {
    const PARAM_REL_POSITION = 903;
    const a = testName("cpo_w_a");
    const b = testName("cpo_w_b");
    await makePoly(c, a);
    await makePoly(c, b);

    // Move cube B 1000 units along +X. With preserve_world_position=true
    // (default) the merged mesh must span ~1000 units along X; with
    // preserve_world_position=false the merge would superimpose the
    // sources, giving a ~200-unit span (each cube is 200 units wide).
    await c.call("set_params", {
      handle: { kind: "object", name: b },
      values: [{ path: PARAM_REL_POSITION, value: [1000, 0, 0] }],
    });

    const r = await c.call<{
      merged: { handle: { path: string; name: string } };
    }>("connect_polygon_objects", {
      objects: [
        { kind: "object", name: a },
        { kind: "object", name: b },
      ],
    });

    const mesh = await c.call<{ points: Array<[number, number, number]> }>("get_mesh", {
      handle: r.merged.handle,
    });
    const xs = mesh.points.map((p) => p[0]);
    const span = Math.max(...xs) - Math.min(...xs);
    // With preservation: ~1100 (1000 offset + 100 half-cube each side).
    // Without preservation: ~200 (just the cube's own size).
    expect(span).toBeGreaterThan(800);
  });

  // The merged handle the bridge returns should be immediately usable for
  // downstream tools — verifies the path/name encoding is correct.
  test("returned merged handle resolves through describe", async () => {
    const a = testName("cpo_h_a");
    const b = testName("cpo_h_b");
    await makePoly(c, a);
    await makePoly(c, b);

    const r = await c.call<{
      merged: { handle: { kind: string; path: string; name: string } };
    }>("connect_polygon_objects", {
      objects: [
        { kind: "object", name: a },
        { kind: "object", name: b },
      ],
    });

    const desc = await c.call<{ summary: { name: string; type_id: number } }>("describe", {
      handle: r.merged.handle,
    });
    expect(desc.summary.type_id).toBe(OPOLYGON);
    expect(desc.summary.name).toBe(r.merged.handle.name);
  });
});
