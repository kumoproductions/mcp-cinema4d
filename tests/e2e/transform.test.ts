import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { cleanupByPrefix, MCPTestClient, probeBridge, resetScene, testName } from "./harness.js";

const probe = await probeBridge("transform");
const ready = probe.ready;
const client: MCPTestClient | null = probe.client ?? null;

describe.skipIf(!ready)("set_transform", () => {
  const c = client!;

  afterAll(async () => {
    await cleanupByPrefix(c);
    await c.close();
  });

  beforeEach(async () => {
    const reset = await resetScene(c);
    if (!reset) await cleanupByPrefix(c);
  });

  test("local pos + rot round-trip via sample_transform", async () => {
    const name = testName("xf_local");
    await c.call("create_entity", { kind: "object", type_id: "cube", name });
    await c.call("set_transform", {
      handle: { kind: "object", name },
      pos: [10, 20, 30],
      rot: [0, 1.5708, 0],
      space: "local",
    });
    const r = await c.call<{
      samples: Array<{ pos: number[]; rot: number[] }>;
    }>("sample_transform", {
      handle: { kind: "object", name },
      frames: [0],
      space: "local",
    });
    expect(r.samples[0].pos).toEqual([10, 20, 30]);
    expect(r.samples[0].rot[1]).toBeCloseTo(1.5708, 3);
  });

  test("global pos sets world-space position through a parent", async () => {
    const parent = testName("xf_parent");
    const child = testName("xf_child");
    await c.call("create_entity", {
      kind: "object",
      type_id: "null",
      name: parent,
      position: [100, 0, 0],
    });
    await c.call("create_entity", {
      kind: "object",
      type_id: "cube",
      name: child,
      parent: { kind: "object", name: parent },
    });
    await c.call("set_transform", {
      handle: { kind: "object", path: `/${parent}/${child}` },
      pos: [200, 0, 0],
      space: "global",
    });
    const r = await c.call<{ samples: Array<{ pos: number[] }> }>("sample_transform", {
      handle: { kind: "object", path: `/${parent}/${child}` },
      frames: [0],
      space: "global",
    });
    expect(r.samples[0].pos[0]).toBeCloseTo(200, 3);
  });

  test("scale writes successfully", async () => {
    const name = testName("xf_scale");
    await c.call("create_entity", { kind: "object", type_id: "cube", name });
    const r = await c.call<{ applied: { scale: number[] } }>("set_transform", {
      handle: { kind: "object", name },
      scale: [2, 3, 4],
    });
    expect(r.applied.scale).toEqual([2, 3, 4]);
  });

  test("matrix overrides pos/rot/scale", async () => {
    const name = testName("xf_matrix");
    await c.call("create_entity", { kind: "object", type_id: "cube", name });
    // Identity-scaled, translated by [5, 0, 0].
    const matrix = [
      [5, 0, 0], // offset
      [1, 0, 0], // v1
      [0, 1, 0], // v2
      [0, 0, 1], // v3
    ];
    await c.call("set_transform", {
      handle: { kind: "object", name },
      matrix,
      space: "local",
    });
    const r = await c.call<{ samples: Array<{ pos: number[] }> }>("sample_transform", {
      handle: { kind: "object", name },
      frames: [0],
      space: "local",
    });
    expect(r.samples[0].pos).toEqual([5, 0, 0]);
  });

  test("rejects passing both matrix and pos", async () => {
    const name = testName("xf_conflict");
    await c.call("create_entity", { kind: "object", type_id: "cube", name });
    const err = await c.callExpectError("set_transform", {
      handle: { kind: "object", name },
      matrix: [
        [0, 0, 0],
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ],
      pos: [1, 2, 3],
    });
    expect(err).toMatch(/matrix|pos|conflict/i);
  });
});
