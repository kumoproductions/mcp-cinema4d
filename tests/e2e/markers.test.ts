import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { MCPTestClient, probeBridge, resetScene, TEST_PREFIX, testName } from "./harness.js";

const probe = await probeBridge("markers");
const ready = probe.ready;
const client: MCPTestClient | null = probe.client ?? null;

type Marker = {
  index: number;
  name: string;
  frame?: number;
  time_seconds?: number;
  length_frames?: number;
  color?: number[];
};

/**
 * Remove only the markers this suite created (``e2e_`` prefix), highest index
 * first so the remaining indices stay valid. Unlike ``remove_marker {all:true}``
 * this never touches a user's own markers — which matters on the rare fallback
 * path where ``resetScene`` couldn't swap in a fresh document and the tests run
 * against the artist's live scene.
 */
async function clearTestMarkers(c: MCPTestClient): Promise<void> {
  const listed = await c
    .call<{ markers: Marker[] }>("list_markers")
    .catch(() => ({ markers: [] as Marker[] }));
  const indices = (listed.markers ?? [])
    .filter((m) => m.name.startsWith(TEST_PREFIX))
    .map((m) => m.index)
    .toSorted((a, b) => b - a);
  for (const index of indices) {
    await c.call("remove_marker", { index }).catch(() => {});
  }
}

describe.skipIf(!ready)("markers", () => {
  const c = client!;

  afterAll(async () => {
    await clearTestMarkers(c);
    await c.close();
  });

  beforeEach(async () => {
    // A fresh document starts with no markers. resetScene's exec_python
    // fallback does NOT clear markers, so always sweep our prefixed markers
    // afterwards regardless of which reset path ran.
    await resetScene(c);
    await clearTestMarkers(c);
    await c.call("set_document", { fps: 30, frame_start: 0, frame_end: 200 });
  });

  // -------------------------------------------------------------------------
  // create_marker
  // -------------------------------------------------------------------------

  test("create_marker places a named marker at a frame", async () => {
    const r = await c.call<Marker>("create_marker", {
      frame: 96,
      name: testName("Shot002"),
    });
    expect(r.frame).toBe(96);
    expect(r.name).toBe(testName("Shot002"));
    expect(r.index).toBeGreaterThanOrEqual(0);
  });

  test("create_marker accepts colour and length", async () => {
    const r = await c.call<Marker>("create_marker", {
      frame: 10,
      name: testName("colored"),
      color: [1, 0, 0],
      length_frames: 12,
    });
    expect(r.color?.[0]).toBeCloseTo(1, 4);
    expect(r.color?.[1]).toBeCloseTo(0, 4);
    expect(r.length_frames).toBe(12);
  });

  test("create_marker supports time_seconds", async () => {
    // 30fps → 2.0s == frame 60
    const r = await c.call<Marker>("create_marker", {
      time_seconds: 2,
      name: testName("bytime"),
    });
    expect(r.frame).toBe(60);
  });

  test("create_marker converts time_seconds using the document fps", async () => {
    await c.call("set_document", { fps: 24 });
    // 24fps → 1.0s == frame 24
    const r = await c.call<Marker>("create_marker", {
      time_seconds: 1,
      name: testName("fps24"),
    });
    expect(r.frame).toBe(24);
  });

  test("create_marker rejects when neither frame nor time_seconds is given", async () => {
    const err = await c.callExpectError("create_marker", { name: testName("nopos") });
    expect(err).toMatch(/frame.*time_seconds|time_seconds.*frame/i);
  });

  test("create_marker rejects when both frame and time_seconds are given", async () => {
    const err = await c.callExpectError("create_marker", {
      frame: 10,
      time_seconds: 2,
      name: testName("both"),
    });
    expect(err).toMatch(/only one of/i);
  });

  // -------------------------------------------------------------------------
  // list_markers + marker_count
  // -------------------------------------------------------------------------

  test("list_markers enumerates created markers", async () => {
    const frames = [0, 96, 135];
    for (const f of frames) {
      await c.call("create_marker", { frame: f, name: testName(`s${f}`) });
    }
    const listed = await c.call<{ markers: Marker[]; count: number }>("list_markers");
    expect(listed.count).toBe(3);
    const byFrame = new Map(listed.markers.map((m) => [m.frame, m]));
    for (const f of frames) {
      expect(byFrame.get(f)?.name).toBe(testName(`s${f}`));
    }
  });

  test("get_document_state reports marker_count", async () => {
    await c.call("create_marker", { frame: 5, name: testName("mc1") });
    await c.call("create_marker", { frame: 15, name: testName("mc2") });
    const state = await c.call<{ marker_count: number }>("get_document_state");
    expect(state.marker_count).toBe(2);
  });

  // -------------------------------------------------------------------------
  // set_marker
  // -------------------------------------------------------------------------

  test("set_marker renames and moves a marker found by index", async () => {
    const created = await c.call<Marker>("create_marker", {
      frame: 20,
      name: testName("before"),
    });
    const r = await c.call<Marker>("set_marker", {
      index: created.index,
      new_name: testName("after"),
      new_frame: 50,
    });
    expect(r.name).toBe(testName("after"));
    expect(r.frame).toBe(50);
  });

  test("set_marker targets a marker by name and moves it via new_time_seconds", async () => {
    await c.call("create_marker", { frame: 12, name: testName("byname") });
    // 30fps → 3.0s == frame 90
    const r = await c.call<Marker>("set_marker", {
      name: testName("byname"),
      new_time_seconds: 3,
    });
    expect(r.frame).toBe(90);
  });

  test("set_marker targets a marker by frame and recolours it", async () => {
    await c.call("create_marker", { frame: 77, name: testName("recolor") });
    const r = await c.call<Marker>("set_marker", { frame: 77, color: [0, 1, 0] });
    expect(r.color?.[1]).toBeCloseTo(1, 4);
  });

  test("set_marker resizes a marker via length_frames", async () => {
    const created = await c.call<Marker>("create_marker", { frame: 40, name: testName("resize") });
    const r = await c.call<Marker>("set_marker", { index: created.index, length_frames: 25 });
    expect(r.length_frames).toBe(25);
  });

  test("set_marker rejects when no update field is provided", async () => {
    await c.call("create_marker", { frame: 3, name: testName("noupd") });
    const err = await c.callExpectError("set_marker", { frame: 3 });
    expect(err).toMatch(/nothing to do/i);
  });

  test("set_marker rejects when more than one selector is given", async () => {
    await c.call("create_marker", { frame: 8, name: testName("multisel") });
    const err = await c.callExpectError("set_marker", { index: 0, frame: 8, new_name: "x" });
    expect(err).toMatch(/exactly one of/i);
  });

  test("set_marker rejects moving via both new_frame and new_time_seconds", async () => {
    const created = await c.call<Marker>("create_marker", { frame: 8, name: testName("movedup") });
    const err = await c.callExpectError("set_marker", {
      index: created.index,
      new_frame: 10,
      new_time_seconds: 2,
    });
    expect(err).toMatch(/only one of/i);
  });

  test("set_marker errors when the target frame is ambiguous", async () => {
    await c.call("create_marker", { frame: 60, name: testName("dup1") });
    await c.call("create_marker", { frame: 60, name: testName("dup2") });
    const err = await c.callExpectError("set_marker", { frame: 60, new_name: "x" });
    expect(err).toMatch(/use 'index' instead/i);
  });

  test("set_marker rejects an out-of-range index", async () => {
    await c.call("create_marker", { frame: 5, name: testName("inrange") });
    const err = await c.callExpectError("set_marker", { index: 999, new_name: "x" });
    expect(err).toMatch(/out of range/i);
  });

  // -------------------------------------------------------------------------
  // remove_marker
  // -------------------------------------------------------------------------

  test("remove_marker deletes a single marker by frame", async () => {
    await c.call("create_marker", { frame: 0, name: testName("keep") });
    await c.call("create_marker", { frame: 30, name: testName("drop") });
    const r = await c.call<{ removed: number }>("remove_marker", { frame: 30 });
    expect(r.removed).toBe(1);
    const listed = await c.call<{ count: number }>("list_markers");
    expect(listed.count).toBe(1);
  });

  test("remove_marker deletes a single marker by index", async () => {
    await c.call("create_marker", { frame: 0, name: testName("i0") });
    const second = await c.call<Marker>("create_marker", { frame: 30, name: testName("i1") });
    const r = await c.call<{ removed: number }>("remove_marker", { index: second.index });
    expect(r.removed).toBe(1);
    const listed = await c.call<{ markers: Marker[] }>("list_markers");
    expect(listed.markers.map((m) => m.name)).toEqual([testName("i0")]);
  });

  test("remove_marker all clears every marker", async (ctx) => {
    // `all:true` is the one destructive call in this suite, and per the
    // clearTestMarkers note above it must never reach an artist's markers.
    // beforeEach has already reset the scene and swept our own prefixed
    // markers, so anything still present belongs to the user — which means
    // resetScene took the exec_python fallback and we're in a live document.
    // Skip rather than wipe it.
    const preexisting = await c.call<{ count: number }>("list_markers");
    if (preexisting.count > 0) {
      ctx.skip(`document carries ${preexisting.count} non-test marker(s)`);
      return;
    }
    await c.call("create_marker", { frame: 0, name: testName("a") });
    await c.call("create_marker", { frame: 10, name: testName("b") });
    const r = await c.call<{ removed: number }>("remove_marker", { all: true });
    expect(r.removed).toBe(2);
    const listed = await c.call<{ count: number }>("list_markers");
    expect(listed.count).toBe(0);
  });

  test("remove_marker errors on a frame with no marker", async () => {
    await c.call("create_marker", { frame: 1, name: testName("lonely") });
    const err = await c.callExpectError("remove_marker", { frame: 999 });
    expect(err).toMatch(/no marker at frame/i);
  });

  test("remove_marker rejects when no selector is given", async () => {
    await c.call("create_marker", { frame: 1, name: testName("sel") });
    const err = await c.callExpectError("remove_marker", {});
    expect(err).toMatch(/exactly one of/i);
  });
});
