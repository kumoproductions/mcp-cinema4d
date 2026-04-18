import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { cleanupByPrefix, MCPTestClient, probeBridge, resetScene, testName } from "./harness.js";

const OCUBE = 5159;
const PARAM_REL_POSITION = 903;
const PARAM_REL_ROTATION = 904;

const probe = await probeBridge("animation");
const ready = probe.ready;
const client: MCPTestClient | null = probe.client ?? null;

describe.skipIf(!ready)("animation (read)", () => {
  const c = client!;

  afterAll(async () => {
    await cleanupByPrefix(c);
    await c.close();
  });

  beforeEach(async () => {
    const reset = await resetScene(c);
    if (!reset) await cleanupByPrefix(c);
  });

  test("list_tracks returns nothing for a fresh object", async () => {
    const name = testName("lt_fresh");
    await c.call("create_entity", { kind: "object", type_id: OCUBE, name });
    const r = await c.call<{ tracks: Array<unknown> }>("list_tracks", {
      handle: { kind: "object", name },
    });
    expect(r.tracks.length).toBe(0);
  });

  test("list_tracks reports a track after set_keyframe creates one", async () => {
    const name = testName("lt_created");
    await c.call("create_entity", { kind: "object", type_id: OCUBE, name });
    await c.call("set_keyframe", {
      handle: { kind: "object", name },
      param_id: PARAM_REL_ROTATION,
      component: "x",
      frame: 10,
      value: 0.5,
    });
    const r = await c.call<{
      tracks: Array<{ param_id: number; component: string | null; key_count: number }>;
    }>("list_tracks", { handle: { kind: "object", name } });
    expect(r.tracks.length).toBeGreaterThan(0);
    const hit = r.tracks.find((t) => t.param_id === PARAM_REL_ROTATION && t.component === "x");
    expect(hit).toBeDefined();
    expect(hit!.key_count).toBe(1);
  });

  test("get_keyframes returns frame + value for each key on a track", async () => {
    const name = testName("gk_cube");
    await c.call("create_entity", { kind: "object", type_id: OCUBE, name });
    await c.call("set_keyframe", {
      handle: { kind: "object", name },
      param_id: PARAM_REL_POSITION,
      component: "y",
      frame: 0,
      value: 0,
    });
    await c.call("set_keyframe", {
      handle: { kind: "object", name },
      param_id: PARAM_REL_POSITION,
      component: "y",
      frame: 20,
      value: 100,
    });

    const r = await c.call<{
      keys: Array<{ frame: number; value: number; interp: string }>;
    }>("get_keyframes", {
      handle: { kind: "object", name },
      param_id: PARAM_REL_POSITION,
      component: "y",
    });
    expect(r.keys.length).toBe(2);
    const frames = r.keys.map((k) => k.frame).sort((a, b) => a - b);
    expect(frames).toEqual([0, 20]);
    const at20 = r.keys.find((k) => k.frame === 20)!;
    expect(at20.value).toBeCloseTo(100, 3);
  });

  test("delete_keyframe at a specific frame removes that one key", async () => {
    const name = testName("dk_single");
    await c.call("create_entity", { kind: "object", type_id: OCUBE, name });
    for (const f of [0, 10, 20]) {
      await c.call("set_keyframe", {
        handle: { kind: "object", name },
        param_id: PARAM_REL_POSITION,
        component: "y",
        frame: f,
        value: f * 2,
      });
    }
    const r = await c.call<{ removed: number }>("delete_keyframe", {
      handle: { kind: "object", name },
      param_id: PARAM_REL_POSITION,
      component: "y",
      frame: 10,
    });
    expect(r.removed).toBe(1);

    const after = await c.call<{ keys: Array<{ frame: number }> }>("get_keyframes", {
      handle: { kind: "object", name },
      param_id: PARAM_REL_POSITION,
      component: "y",
    });
    expect(after.keys.map((k) => k.frame).toSorted((a, b) => a - b)).toEqual([0, 20]);
  });

  test("delete_keyframe with start_frame/end_frame removes a range", async () => {
    const name = testName("dk_range");
    await c.call("create_entity", { kind: "object", type_id: OCUBE, name });
    for (const f of [0, 5, 10, 15, 20]) {
      await c.call("set_keyframe", {
        handle: { kind: "object", name },
        param_id: PARAM_REL_POSITION,
        component: "x",
        frame: f,
        value: f,
      });
    }
    const r = await c.call<{ removed: number }>("delete_keyframe", {
      handle: { kind: "object", name },
      param_id: PARAM_REL_POSITION,
      component: "x",
      start_frame: 5,
      end_frame: 15,
    });
    expect(r.removed).toBe(3); // frames 5, 10, 15

    const after = await c.call<{ keys: Array<{ frame: number }> }>("get_keyframes", {
      handle: { kind: "object", name },
      param_id: PARAM_REL_POSITION,
      component: "x",
    });
    expect(after.keys.map((k) => k.frame).toSorted((a, b) => a - b)).toEqual([0, 20]);
  });

  test("delete_track removes the entire animation track for the param", async () => {
    const name = testName("dt_cube");
    await c.call("create_entity", { kind: "object", type_id: OCUBE, name });
    await c.call("set_keyframe", {
      handle: { kind: "object", name },
      param_id: PARAM_REL_POSITION,
      component: "x",
      frame: 10,
      value: 5,
    });
    const before = await c.call<{ tracks: Array<unknown> }>("list_tracks", {
      handle: { kind: "object", name },
    });
    expect(before.tracks.length).toBeGreaterThan(0);

    const r = await c.call<{ removed: boolean }>("delete_track", {
      handle: { kind: "object", name },
      param_id: PARAM_REL_POSITION,
      component: "x",
    });
    expect(r.removed).toBe(true);

    const after = await c.call<{ tracks: Array<{ param_id: number; component: string | null }> }>(
      "list_tracks",
      { handle: { kind: "object", name } },
    );
    expect(after.tracks.some((t) => t.param_id === PARAM_REL_POSITION && t.component === "x")).toBe(
      false,
    );
  });

  test("get_keyframes honours start_frame / end_frame window", async () => {
    const name = testName("gk_window");
    await c.call("create_entity", { kind: "object", type_id: OCUBE, name });
    for (const f of [0, 10, 20, 30]) {
      await c.call("set_keyframe", {
        handle: { kind: "object", name },
        param_id: PARAM_REL_POSITION,
        component: "x",
        frame: f,
        value: f,
      });
    }

    const r = await c.call<{ keys: Array<{ frame: number }> }>("get_keyframes", {
      handle: { kind: "object", name },
      param_id: PARAM_REL_POSITION,
      component: "x",
      start_frame: 5,
      end_frame: 25,
    });
    const frames = r.keys.map((k) => k.frame).sort((a, b) => a - b);
    expect(frames).toEqual([10, 20]);
  });
});
