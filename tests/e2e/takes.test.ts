import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { cleanupByPrefix, MCPTestClient, probeBridge, resetScene, testName } from "./harness.js";

const OCAMERA = 5103; // c4d.Ocamera
const PARAM_REL_POSITION = 903; // c4d.ID_BASEOBJECT_REL_POSITION

const probe = await probeBridge("takes");
const ready = probe.ready;
const client: MCPTestClient | null = probe.client ?? null;

describe.skipIf(!ready)("takes", () => {
  const c = client!;

  afterAll(async () => {
    await cleanupByPrefix(c);
    await c.close();
  });

  beforeEach(async () => {
    const reset = await resetScene(c);
    if (!reset) await cleanupByPrefix(c);
  });

  async function mainTakeName(): Promise<string> {
    const takes = await c.call<{ entities: Array<{ name: string; is_main: boolean }> }>(
      "list_entities",
      { kind: "take" },
    );
    const main = takes.entities.find((t) => t.is_main);
    if (!main) throw new Error("no Main take found");
    return main.name;
  }

  // -------------------------------------------------------------------------
  // create_take
  // -------------------------------------------------------------------------

  test("create_take links camera + render_data and defaults to checked", async () => {
    const camName = testName("cam");
    const rdName = testName("rd_take");
    const takeName = testName("take");
    await c.call("create_entity", { kind: "object", type_id: OCAMERA, name: camName });
    await c.call("create_render_data", { name: rdName });

    const r = await c.call<{
      handle: { kind: string; name: string };
      camera: string | null;
      render_data: string | null;
      checked: boolean;
      created: boolean;
    }>("create_take", { name: takeName, camera: camName, render_data: rdName });

    expect(r.created).toBe(true);
    expect(r.handle.name).toBe(takeName);
    expect(r.camera).toBe(camName);
    expect(r.render_data).toBe(rdName);
    expect(r.checked).toBe(true);
  });

  // -------------------------------------------------------------------------
  // child takes: parent + listing
  // -------------------------------------------------------------------------

  test("create_take with parent nests under the parent take", async () => {
    const parent = testName("tparent");
    const child = testName("tchild");
    await c.call("create_take", { name: parent });
    const r = await c.call<{
      created: boolean;
      handle: { name: string };
    }>("create_take", { name: child, parent });
    expect(r.created).toBe(true);
    expect(r.handle.name).toBe(child);

    const listed = await c.call<{
      entities: Array<{ name: string; depth: number; parent: string | null }>;
    }>("list_entities", { kind: "take", name_pattern: `^e2e_t(parent|child)$` });
    const byName = new Map(listed.entities.map((e) => [e.name, e]));
    expect(byName.get(parent)?.depth).toBe(1); // parent is one below Main
    expect(byName.get(child)?.depth).toBe(2);
    expect(byName.get(child)?.parent).toBe(parent);
  });

  test("list_entities take exposes the Main take with parent=null", async () => {
    const main = await mainTakeName();
    const listed = await c.call<{
      entities: Array<{
        name: string;
        is_main: boolean;
        depth: number;
        parent: string | null;
      }>;
    }>("list_entities", { kind: "take", name_pattern: `^${main}$` });
    expect(listed.entities.length).toBe(1);
    expect(listed.entities[0].is_main).toBe(true);
    expect(listed.entities[0].depth).toBe(0);
    expect(listed.entities[0].parent).toBe(null);
  });

  // -------------------------------------------------------------------------
  // take_override
  // -------------------------------------------------------------------------

  test("take_override writes a values[] override on a non-Main take", async () => {
    const cam = testName("ov_cam");
    const take = testName("ov_take");
    await c.call("create_entity", { kind: "object", type_id: OCAMERA, name: cam });
    await c.call("create_take", { name: take, camera: cam, make_active: true });

    const r = await c.call<{
      applied: Array<{ path: unknown; value: unknown }>;
      errors: unknown[];
      cleared: unknown[];
      removed_all: boolean;
      take: string;
    }>("take_override", {
      take,
      target: { kind: "object", name: cam },
      values: [{ path: PARAM_REL_POSITION, value: [10, 20, 30] }],
    });
    expect(r.take).toBe(take);
    expect(r.errors).toEqual([]);
    expect(r.applied.length).toBe(1);
    expect(r.applied[0].value).toEqual([10, 20, 30]);
    expect(r.removed_all).toBe(false);
  });

  test("take_override accepts params shorthand", async () => {
    const cam = testName("ov_short_cam");
    const take = testName("ov_short_take");
    await c.call("create_entity", { kind: "object", type_id: OCAMERA, name: cam });
    await c.call("create_take", { name: take, camera: cam, make_active: true });

    const r = await c.call<{
      applied: Array<{ path: unknown; value: unknown }>;
      errors: unknown[];
    }>("take_override", {
      take,
      target: { kind: "object", name: cam },
      params: { [String(PARAM_REL_POSITION)]: [1, 2, 3] },
    });
    expect(r.errors).toEqual([]);
    expect(r.applied.length).toBe(1);
    expect(r.applied[0].value).toEqual([1, 2, 3]);
  });

  test("take_override clears a previously-set path", async () => {
    const cam = testName("ov_clear_cam");
    const take = testName("ov_clear_take");
    await c.call("create_entity", { kind: "object", type_id: OCAMERA, name: cam });
    await c.call("create_take", { name: take, camera: cam, make_active: true });

    // Seed an override first.
    await c.call("take_override", {
      take,
      target: { kind: "object", name: cam },
      values: [{ path: PARAM_REL_POSITION, value: [5, 5, 5] }],
    });
    const r = await c.call<{ cleared: unknown[]; errors: unknown[] }>("take_override", {
      take,
      target: { kind: "object", name: cam },
      clear: [PARAM_REL_POSITION],
    });
    expect(r.errors).toEqual([]);
    expect(r.cleared.length).toBe(1);
  });

  test("take_override remove_all produces a deterministic response", async () => {
    const cam = testName("ov_rm_cam");
    const take = testName("ov_rm_take");
    await c.call("create_entity", { kind: "object", type_id: OCAMERA, name: cam });
    await c.call("create_take", { name: take, camera: cam, make_active: true });
    await c.call("take_override", {
      take,
      target: { kind: "object", name: cam },
      values: [{ path: PARAM_REL_POSITION, value: [9, 9, 9] }],
    });

    // RemoveOverride is SDK-version dependent — the bridge either drops the
    // whole override (removed_all:true) or reports that only KillOverrides
    // exists. Either is acceptable; we pin both branches.
    const r = await c.call<{
      removed_all: boolean;
      errors: Array<{ path: unknown; error: string }>;
    }>("take_override", {
      take,
      target: { kind: "object", name: cam },
      remove_all: true,
    });
    if (r.removed_all) {
      expect(r.errors).toEqual([]);
    } else {
      expect(r.errors.length).toBeGreaterThan(0);
      expect(r.errors[0].error).toMatch(/RemoveOverride|KillOverrides/);
    }
  });

  test("take_override rejects the Main take", async () => {
    const cam = testName("ov_main_cam");
    await c.call("create_entity", { kind: "object", type_id: OCAMERA, name: cam });
    const main = await mainTakeName();
    const err = await c.callExpectError("take_override", {
      take: main,
      target: { kind: "object", name: cam },
      values: [{ path: PARAM_REL_POSITION, value: [1, 2, 3] }],
    });
    expect(err).toMatch(/main take/i);
  });

  test("take_override rejects an unknown take", async () => {
    const cam = testName("ov_404_cam");
    await c.call("create_entity", { kind: "object", type_id: OCAMERA, name: cam });
    const err = await c.callExpectError("take_override", {
      take: testName("ov_nope"),
      target: { kind: "object", name: cam },
      values: [{ path: PARAM_REL_POSITION, value: [1, 2, 3] }],
    });
    expect(err).toMatch(/take not found/i);
  });

  test("take_override rejects when no writes / clears / removals are requested", async () => {
    const cam = testName("ov_noop_cam");
    const take = testName("ov_noop_take");
    await c.call("create_entity", { kind: "object", type_id: OCAMERA, name: cam });
    await c.call("create_take", { name: take, camera: cam });
    const err = await c.callExpectError("take_override", {
      take,
      target: { kind: "object", name: cam },
    });
    expect(err).toMatch(/nothing to do/i);
  });

  test("take_override reports an unresolvable target", async () => {
    const take = testName("ov_badtarget_take");
    await c.call("create_take", { name: take });
    const err = await c.callExpectError("take_override", {
      take,
      target: { kind: "object", name: testName("ov_missing_cam") },
      values: [{ path: PARAM_REL_POSITION, value: [0, 0, 0] }],
    });
    expect(err).toMatch(/not resolved|not found/i);
  });

  test("take_override value reads back through the scene when its take is active", async () => {
    const cam = testName("prop_cam");
    const take = testName("prop_take");
    await c.call("create_entity", { kind: "object", type_id: OCAMERA, name: cam });
    await c.call("create_take", { name: take, camera: cam });

    await c.call("take_override", {
      take,
      target: { kind: "object", name: cam },
      values: [{ path: PARAM_REL_POSITION, value: [10, 20, 30] }],
    });

    // Activating the take should push the override onto the scene node.
    await c.call("set_document", { active_take: take });
    const got = await c.call<{ values: Array<{ value: number[] }> }>("get_params", {
      handle: { kind: "object", name: cam },
      ids: [PARAM_REL_POSITION],
    });
    expect(got.values[0].value).toEqual([10, 20, 30]);

    // Switching back to Main should surface the scene-level value (0,0,0).
    await c.call("set_document", { active_take: await mainTakeName() });
    const main = await c.call<{ values: Array<{ value: number[] }> }>("get_params", {
      handle: { kind: "object", name: cam },
      ids: [PARAM_REL_POSITION],
    });
    expect(main.values[0].value).toEqual([0, 0, 0]);
  });

  test("take_override clear restores the scene-level value on the active take", async () => {
    const cam = testName("clear_cam");
    const take = testName("clear_take");
    await c.call("create_entity", { kind: "object", type_id: OCAMERA, name: cam });
    await c.call("create_take", { name: take, camera: cam });

    // Seed an override then verify it takes effect.
    await c.call("take_override", {
      take,
      target: { kind: "object", name: cam },
      values: [{ path: PARAM_REL_POSITION, value: [7, 7, 7] }],
    });
    await c.call("set_document", { active_take: take });
    const before = await c.call<{ values: Array<{ value: number[] }> }>("get_params", {
      handle: { kind: "object", name: cam },
      ids: [PARAM_REL_POSITION],
    });
    expect(before.values[0].value).toEqual([7, 7, 7]);

    // Clearing drops the override — the active take should now expose the
    // Main-side scene value again.
    await c.call("take_override", {
      take,
      target: { kind: "object", name: cam },
      clear: [PARAM_REL_POSITION],
    });
    const after = await c.call<{ values: Array<{ value: number[] }> }>("get_params", {
      handle: { kind: "object", name: cam },
      ids: [PARAM_REL_POSITION],
    });
    expect(after.values[0].value).toEqual([0, 0, 0]);
  });

  test("take_override writes multiple values in one call", async () => {
    const PARAM_REL_ROTATION = 904;
    const cam = testName("multi_cam");
    const take = testName("multi_take");
    await c.call("create_entity", { kind: "object", type_id: OCAMERA, name: cam });
    await c.call("create_take", { name: take, camera: cam });

    const r = await c.call<{ applied: Array<unknown>; errors: unknown[] }>("take_override", {
      take,
      target: { kind: "object", name: cam },
      values: [
        { path: PARAM_REL_POSITION, value: [1, 2, 3] },
        { path: PARAM_REL_ROTATION, value: [0, 0, 0.5] },
      ],
    });
    expect(r.errors).toEqual([]);
    expect(r.applied.length).toBe(2);

    await c.call("set_document", { active_take: take });
    const got = await c.call<{ values: Array<{ value: number[] }> }>("get_params", {
      handle: { kind: "object", name: cam },
      ids: [PARAM_REL_POSITION, PARAM_REL_ROTATION],
    });
    expect(got.values[0].value).toEqual([1, 2, 3]);
    expect(got.values[1].value[2]).toBeCloseTo(0.5, 4);
  });

  test("take_override overrides a single vector component via DescID path", async () => {
    const cam = testName("desc_cam");
    const take = testName("desc_take");
    await c.call("create_entity", { kind: "object", type_id: OCAMERA, name: cam });
    await c.call("create_take", { name: take, camera: cam });

    await c.call("take_override", {
      take,
      target: { kind: "object", name: cam },
      values: [{ path: [PARAM_REL_POSITION, "y"], value: 42 }],
    });
    await c.call("set_document", { active_take: take });
    const got = await c.call<{ values: Array<{ value: number[] }> }>("get_params", {
      handle: { kind: "object", name: cam },
      ids: [PARAM_REL_POSITION],
    });
    // Only .y should be overridden; .x and .z stay at the scene default.
    expect(got.values[0].value[0]).toBe(0);
    expect(got.values[0].value[1]).toBe(42);
    expect(got.values[0].value[2]).toBe(0);
  });

  test("take_override works on a material target", async () => {
    const MAT_STANDARD = 5703;
    const MATERIAL_USE_COLOR = 2001; // c4d.MATERIAL_USE_COLOR — boolean toggle
    const matName = testName("ov_mat");
    const take = testName("ov_mat_take");
    await c.call("create_entity", { kind: "material", type_id: MAT_STANDARD, name: matName });
    await c.call("create_take", { name: take });

    const r = await c.call<{ applied: Array<unknown>; errors: unknown[] }>("take_override", {
      take,
      target: { kind: "material", name: matName },
      values: [{ path: MATERIAL_USE_COLOR, value: false }],
    });
    expect(r.errors).toEqual([]);
    expect(r.applied.length).toBe(1);

    await c.call("set_document", { active_take: take });
    // get_params reports bool params as int 0/1 over the wire.
    const got = await c.call<{ values: Array<{ value: number }> }>("get_params", {
      handle: { kind: "material", name: matName },
      ids: [MATERIAL_USE_COLOR],
    });
    expect(got.values[0].value).toBe(0);
  });
});
