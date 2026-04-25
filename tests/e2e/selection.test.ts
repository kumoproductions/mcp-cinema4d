import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { cleanupByPrefix, MCPTestClient, probeBridge, resetScene, testName } from "./harness.js";

const OCUBE = 5159;
const ONULL = 5140;
const TPHONG = 5612;
const MAT_STANDARD = 5703; // c4d.Mmaterial

const probe = await probeBridge("selection");
const ready = probe.ready;
const client: MCPTestClient | null = probe.client ?? null;

describe.skipIf(!ready)("selection", () => {
  const c = client!;

  afterAll(async () => {
    await cleanupByPrefix(c);
    await c.close();
  });

  beforeEach(async () => {
    const reset = await resetScene(c);
    if (!reset) await cleanupByPrefix(c);
  });

  test("get_selection on a fresh scene returns null actives and empty list", async () => {
    const r = await c.call<{
      active_object: unknown;
      selected_objects: unknown[];
      active_tag: unknown;
      active_material: unknown;
    }>("get_selection");
    expect(r.active_object).toBeNull();
    expect(r.selected_objects).toEqual([]);
    expect(r.active_tag).toBeNull();
    expect(r.active_material).toBeNull();
  });

  test("set_selection picks a single object and get_selection reflects it", async () => {
    const name = testName("sel_obj");
    await c.call("create_entity", { kind: "object", type_id: OCUBE, name });
    const out = await c.call<{
      set: { objects: Array<{ kind: string; path?: string; name?: string }> };
    }>("set_selection", {
      objects: [{ kind: "object", name }],
    });
    expect(out.set.objects.length).toBe(1);
    expect(out.set.objects[0].kind).toBe("object");

    const r = await c.call<{
      active_object: { kind: string; path: string };
      selected_objects: Array<{ kind: string; path: string }>;
    }>("get_selection");
    expect(r.active_object.path).toBe(`/${name}`);
    expect(r.selected_objects.map((o) => o.path)).toContain(`/${name}`);
  });

  test("set_selection mode=add extends the existing selection", async () => {
    const a = testName("sel_a");
    const b = testName("sel_b");
    await c.call("create_entity", { kind: "object", type_id: OCUBE, name: a });
    await c.call("create_entity", { kind: "object", type_id: ONULL, name: b });
    await c.call("set_selection", { objects: [{ kind: "object", name: a }] });
    await c.call("set_selection", {
      objects: [{ kind: "object", name: b }],
      mode: "add",
    });
    const r = await c.call<{ selected_objects: Array<{ path: string }> }>("get_selection");
    const paths = r.selected_objects.map((o) => o.path).toSorted();
    expect(paths).toEqual([`/${a}`, `/${b}`]);
  });

  test("set_selection mode=replace (default) clears prior selection", async () => {
    const a = testName("repl_a");
    const b = testName("repl_b");
    await c.call("create_entity", { kind: "object", type_id: OCUBE, name: a });
    await c.call("create_entity", { kind: "object", type_id: ONULL, name: b });
    await c.call("set_selection", { objects: [{ kind: "object", name: a }] });
    await c.call("set_selection", { objects: [{ kind: "object", name: b }] });
    const r = await c.call<{ selected_objects: Array<{ path: string }> }>("get_selection");
    expect(r.selected_objects.map((o) => o.path)).toEqual([`/${b}`]);
  });

  test("set_selection also handles tag + material", async () => {
    const owner = testName("sel_owner");
    const matName = testName("sel_mat");
    await c.call("create_entity", { kind: "object", type_id: OCUBE, name: owner });
    await c.call("create_entity", {
      kind: "tag",
      type_id: TPHONG,
      parent: { kind: "object", name: owner },
    });
    await c.call("create_entity", { kind: "material", type_id: MAT_STANDARD, name: matName });

    await c.call("set_selection", {
      tag: { kind: "tag", object: owner, type_id: TPHONG },
      material: { kind: "material", name: matName },
    });
    const r = await c.call<{
      active_tag: { kind: string; object: string; type_id: number } | null;
      active_material: { kind: string; name: string } | null;
    }>("get_selection");
    expect(r.active_tag?.type_id).toBe(TPHONG);
    expect(r.active_material?.name).toBe(matName);
  });

  test("set_selection clear=true deselects everything", async () => {
    const n = testName("sel_clear");
    await c.call("create_entity", { kind: "object", type_id: OCUBE, name: n });
    await c.call("set_selection", { objects: [{ kind: "object", name: n }] });
    await c.call("set_selection", { clear: true });
    const r = await c.call<{
      active_object: unknown;
      selected_objects: unknown[];
    }>("get_selection");
    expect(r.active_object).toBeNull();
    expect(r.selected_objects).toEqual([]);
  });
});
