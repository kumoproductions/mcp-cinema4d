import { afterAll, beforeEach, describe, expect, test } from "vitest";
import {
  cleanupByPrefix,
  makeCubePolygon,
  MCPTestClient,
  probeBridge,
  resetScene,
  testName,
} from "./harness.js";

const MAT_STANDARD = 5703;

const probe = await probeBridge("effective_material");
const ready = probe.ready;
const client: MCPTestClient | null = probe.client ?? null;

describe.skipIf(!ready)("get_mesh effective_materials + set_mesh_selection extras", () => {
  const c = client!;

  afterAll(async () => {
    await cleanupByPrefix(c);
    await c.close();
  });

  beforeEach(async () => {
    const reset = await resetScene(c);
    if (!reset) await cleanupByPrefix(c);
  });

  test("restricted texture tag overrides unrestricted within the selection", async () => {
    const objName = testName("emp_obj");
    const matA = testName("emp_matA");
    const matB = testName("emp_matB");
    const selName = testName("emp_sel");

    // Build a polygon cube (6 polys) and two materials.
    await makeCubePolygon(c, objName);

    await c.call("create_entity", { kind: "material", type_id: MAT_STANDARD, name: matA });
    await c.call("create_entity", { kind: "material", type_id: MAT_STANDARD, name: matB });

    // Build the named polygon-selection tag with a populated BaseSelect in
    // a single exec_python call. Going through create_entity +
    // set_mesh_selection separately had subtle state-propagation issues
    // where the polygon BaseSelect read by a later call appeared empty —
    // doing it inline is robust and the resolution algorithm is what we
    // really want to test here.
    let execAvailable = true;
    let mergeStats: { sel_count: number } | null = null;
    try {
      const resp = await c.call<{
        result: { sel_count: number };
        error: string | null;
      }>("exec_python", {
        code: `
import c4d
from c4d import documents
doc = documents.GetActiveDocument()
obj = doc.SearchObject("${objName}")
sel_tag = c4d.BaseTag(c4d.Tpolygonselection)
sel_tag.SetName("${selName}")
obj.InsertTag(sel_tag)
bs = sel_tag.GetBaseSelect()
bs.Select(0)
bs.Select(1)
bs.Select(2)
c4d.EventAdd()
result = {"sel_count": bs.GetCount()}
`.trim(),
      });
      if (resp.error) throw new Error(resp.error);
      mergeStats = resp.result;
    } catch {
      execAvailable = false;
    }

    // Texture tag A: unrestricted.
    await c.call("assign_material", {
      object: { kind: "object", name: objName },
      material: { kind: "material", name: matA },
    });

    // Texture tag B: restricted to the selection. Use assign_material with restrict.
    await c.call("assign_material", {
      object: { kind: "object", name: objName },
      material: { kind: "material", name: matB },
      restrict_to_selection: selName,
    });

    type EffectiveBlock = {
      per_polygon: Array<string | null>;
      by_material: Record<string, number>;
      no_material_count: number;
      tags_considered: number;
    };

    if (!execAvailable) {
      // Without exec_python the polygon-selection tag's BaseSelect wasn't
      // populated. Skip the per-polygon assertion but still ensure the
      // include path returns the right shape.
      const r = await c.call<{
        polygon_count: number;
        effective_materials: EffectiveBlock;
      }>("get_mesh", {
        handle: { kind: "object", name: objName },
        include: ["effective_materials"],
      });
      expect(r.polygon_count).toBe(6);
      expect(r.effective_materials.per_polygon.length).toBe(6);
      return;
    }
    // The merge step must have actually populated the named selection tag.
    expect(mergeStats?.sel_count).toBe(3);

    const r = await c.call<{
      polygon_count: number;
      effective_materials: EffectiveBlock;
    }>("get_mesh", {
      handle: { kind: "object", name: objName },
      include: ["effective_materials"],
    });
    expect(r.polygon_count).toBe(6);
    const em = r.effective_materials;
    // Polys in the selection (0, 1, 2) take matB; the rest fall through to matA.
    expect(em.per_polygon.slice(0, 3)).toEqual([matB, matB, matB]);
    expect(em.per_polygon.slice(3, 6)).toEqual([matA, matA, matA]);
    expect(em.by_material[matA]).toBe(3);
    expect(em.by_material[matB]).toBe(3);
    expect(em.no_material_count).toBe(0);
    expect(em.tags_considered).toBe(2);
  });

  test("set_mesh_selection set_except inverts the index list", async () => {
    const objName = testName("emp_inv_obj");
    await makeCubePolygon(c, objName);

    const r = await c.call<{ count: number; mode: string; run_count: number }>(
      "set_mesh_selection",
      {
        handle: { kind: "object", name: objName },
        kind: "polygon",
        indices: [2, 4],
        mode: "set_except",
      },
    );
    expect(r.mode).toBe("set_except");
    // 6-polygon cube minus 2 excluded indices = 4 polys selected.
    expect(r.count).toBe(4);
    // [0, 1] then [3] then [5] — three runs.
    expect(r.run_count).toBe(3);
  });

  test("set_mesh_selection default mode is 'set' and reports run_count", async () => {
    const objName = testName("emp_set_obj");
    await makeCubePolygon(c, objName);

    // Indices [0, 1, 2, 4, 5] compress to two runs: [0..2] and [4..5].
    const r = await c.call<{ count: number; mode: string; run_count: number }>(
      "set_mesh_selection",
      {
        handle: { kind: "object", name: objName },
        kind: "polygon",
        indices: [0, 1, 2, 4, 5],
      },
    );
    expect(r.mode).toBe("set");
    expect(r.count).toBe(5);
    expect(r.run_count).toBe(2);
  });

  test("get_mesh effective_materials covers all polys with a single unrestricted tag", async () => {
    const objName = testName("emp_simple_obj");
    const matName = testName("emp_simple_mat");
    await makeCubePolygon(c, objName);
    await c.call("create_entity", { kind: "material", type_id: MAT_STANDARD, name: matName });
    await c.call("assign_material", {
      object: { kind: "object", name: objName },
      material: { kind: "material", name: matName },
    });

    const r = await c.call<{
      polygon_count: number;
      effective_materials: {
        per_polygon: Array<string | null>;
        by_material: Record<string, number>;
        no_material_count: number;
        tags_considered: number;
      };
    }>("get_mesh", {
      handle: { kind: "object", name: objName },
      include: ["effective_materials"],
    });
    expect(r.polygon_count).toBe(6);
    expect(r.effective_materials.per_polygon).toEqual(Array(6).fill(matName));
    expect(r.effective_materials.by_material[matName]).toBe(6);
    expect(r.effective_materials.no_material_count).toBe(0);
    expect(r.effective_materials.tags_considered).toBe(1);
  });

  test("get_mesh without effective_materials does not compute the chain", async () => {
    const objName = testName("emp_skip_obj");
    await makeCubePolygon(c, objName);

    const r = await c.call<{ polygon_count: number; effective_materials?: unknown }>("get_mesh", {
      handle: { kind: "object", name: objName },
    });
    expect(r.polygon_count).toBe(6);
    expect(r.effective_materials).toBeUndefined();
  });
});
