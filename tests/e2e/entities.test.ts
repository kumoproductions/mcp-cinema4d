import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { cleanupByPrefix, MCPTestClient, probeBridge, resetScene, testName } from "./harness.js";

// c4d.Ocube = 5159, c4d.Onull = 5140, c4d.Ttexture = 5616,
// c4d.Xbitmap = 5833, c4d.ID_BASEOBJECT_REL_POSITION = 903
const OCUBE = 5159;
const ONULL = 5140;
const TTEXTURE = 5616;
const XBITMAP = 5833;
const PARAM_REL_POSITION = 903;

const probe = await probeBridge("entities");
const ready = probe.ready;
const client: MCPTestClient | null = probe.client ?? null;

// exec_python is opt-in by default (MCP hides it when disabled, and the
// bridge rejects the call when disabled server-side). Treat both "tool not
// found" and "disabled" the same — in either case we can't seed shader
// fixtures through exec_python and the dependent tests must skip.
let execPythonDisabled = false;
if (ready && client) {
  try {
    await client.call("exec_python", { code: "result = 1" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    execPythonDisabled = /disabled|not found/i.test(msg);
  }
}

describe.skipIf(!ready)("entities + handles", () => {
  const c = client!;

  afterAll(async () => {
    await cleanupByPrefix(c);
    await c.close();
  });

  beforeEach(async () => {
    const reset = await resetScene(c);
    if (!reset) await cleanupByPrefix(c);
  });

  test("list_entities kind=object reports a newly created cube with path", async () => {
    const name = testName("list_target");
    await c.call("create_entity", { kind: "object", type_id: "cube", name });
    const r = await c.call<{ entities: Array<{ name: string; path: string; depth: number }> }>(
      "list_entities",
      { kind: "object", name_pattern: `^${name}$` },
    );
    expect(r.entities.length).toBe(1);
    expect(r.entities[0].path).toBe(`/${name}`);
    expect(r.entities[0].depth).toBe(0);
  });

  test("describe returns a params array including the position id", async () => {
    const name = testName("desc_target");
    await c.call("create_entity", { kind: "object", type_id: "cube", name });
    const r = await c.call<{
      summary: { name: string };
      params: Array<{ id: number; name: string }>;
    }>("describe", { handle: { kind: "object", name } });
    expect(r.summary.name).toBe(name);
    expect(r.params.some((p) => p.id === PARAM_REL_POSITION)).toBe(true);
  });

  test("set_params → get_params round-trip on vector position", async () => {
    const name = testName("setparams");
    await c.call("create_entity", { kind: "object", type_id: "cube", name });
    const applied = await c.call<{ applied: Array<{ path: unknown; value: unknown }> }>(
      "set_params",
      {
        handle: { kind: "object", name },
        values: [{ path: PARAM_REL_POSITION, value: [5, 6, 7] }],
      },
    );
    expect(applied.applied[0].value).toEqual([5, 6, 7]);

    const got = await c.call<{ values: Array<{ path: unknown; value: unknown }> }>("get_params", {
      handle: { kind: "object", name },
      ids: [PARAM_REL_POSITION],
    });
    expect(got.values[0].value).toEqual([5, 6, 7]);
  });

  test("set_params / get_params accept DescID path for vector components", async () => {
    const name = testName("setparams_desc");
    await c.call("create_entity", { kind: "object", type_id: "cube", name });
    await c.call("set_params", {
      handle: { kind: "object", name },
      values: [{ path: [PARAM_REL_POSITION, "y"], value: 42 }],
    });
    const got = await c.call<{ values: Array<{ path: unknown; value: number }> }>("get_params", {
      handle: { kind: "object", name },
      ids: [[PARAM_REL_POSITION, "y"]],
    });
    expect(got.values[0].value).toBe(42);
  });

  test("create_entity + remove_entity round-trip for objects", async () => {
    const name = testName("created");
    const created = await c.call<{ handle: { kind: string; name: string; path: string } }>(
      "create_entity",
      { kind: "object", type_id: OCUBE, name, position: [1, 2, 3] },
    );
    expect(created.handle.kind).toBe("object");
    expect(created.handle.name).toBe(name);
    expect(created.handle.path).toBe(`/${name}`);

    const removed = await c.call<{ removed: boolean }>("remove_entity", {
      handle: created.handle,
    });
    expect(removed.removed).toBe(true);

    const listed = await c.call<{ entities: unknown[] }>("list_entities", {
      kind: "object",
      name_pattern: `^${name}$`,
    });
    expect(listed.entities.length).toBe(0);
  });

  test("get_container returns a non-empty container and honours id bounds", async () => {
    const name = testName("container");
    await c.call("create_entity", { kind: "object", type_id: "cube", name });
    const full = await c.call<{ container: Record<string, unknown> | null }>("get_container", {
      handle: { kind: "object", name },
    });
    expect(full.container).toBeTruthy();
    expect(Object.keys(full.container!).length).toBeGreaterThan(0);

    // Restricting to an empty window must yield an empty map.
    const narrow = await c.call<{ container: Record<string, unknown> | null }>("get_container", {
      handle: { kind: "object", name },
      id_from: -5,
      id_to: -1,
    });
    expect(narrow.container).toBeTruthy();
    expect(Object.keys(narrow.container!).length).toBe(0);
  });

  test("set_keyframe on rotation component creates a track", async () => {
    const name = testName("kf_target");
    await c.call("create_entity", { kind: "object", type_id: "cube", name });
    const r = await c.call<{ frame: number; dtype: string; value: number }>("set_keyframe", {
      handle: { kind: "object", name },
      param_id: 904, // ID_BASEOBJECT_REL_ROTATION
      component: "x",
      frame: 10,
      value: 0.5,
      interp: "linear",
    });
    expect(r.frame).toBe(10);
    expect(r.value).toBe(0.5);
    expect(r.dtype).toBe("vector");
  });

  test("name ambiguity: duplicate name lookups raise with candidate paths", async () => {
    // Create two objects with the same name using create_entity + path.
    const dup = testName("dup");
    await c.call("create_entity", { kind: "object", type_id: ONULL, name: dup });
    // Nest a second identically-named null under the first, so both exist.
    await c.call("create_entity", {
      kind: "object",
      type_id: ONULL,
      name: dup,
      parent: { kind: "object", path: `/${dup}` },
    });

    const err = await c.callExpectError("describe", {
      handle: { kind: "object", name: dup },
    });
    expect(err).toMatch(/ambiguous/i);
    expect(err).toContain("/" + dup);
  });

  test("path handle disambiguates duplicate names", async () => {
    const dup = testName("dup2");
    await c.call("create_entity", { kind: "object", type_id: ONULL, name: dup });
    await c.call("create_entity", {
      kind: "object",
      type_id: ONULL,
      name: dup,
      parent: { kind: "object", path: `/${dup}` },
    });

    const r = await c.call<{ summary: { name: string; path: string } }>("describe", {
      handle: { kind: "object", path: `/${dup}/${dup}` },
    });
    expect(r.summary.name).toBe(dup);
    expect(r.summary.path).toBe(`/${dup}/${dup}`);
  });

  test("create_entity tag handle carries tag_name", async () => {
    const name = testName("tag_owner");
    await c.call("create_entity", { kind: "object", type_id: "cube", name });
    // c4d.Tdisplay is 5613 — a light tag that exists in every C4D. We use
    // c4d.Tphong = 5612 which is guaranteed to exist and takes no params.
    const TPHONG = 5612;
    const tagName = testName("phong");
    const r = await c.call<{
      handle: {
        kind: string;
        object: string;
        type_id: number;
        tag_name: string;
        object_path: string;
      };
    }>("create_entity", {
      kind: "tag",
      type_id: TPHONG,
      name: tagName,
      parent: { kind: "object", name },
    });
    expect(r.handle.kind).toBe("tag");
    expect(r.handle.tag_name).toBe(tagName);
    expect(r.handle.object).toBe(name);
    expect(r.handle.object_path).toBe(`/${name}`);
  });

  // ---------------------------------------------------------------------
  // list_entities kind=object filter / enrichment extras
  // ---------------------------------------------------------------------

  test("list_entities type_ids filters by object type", async () => {
    const cubeName = testName("ws_cube");
    const nullName = testName("ws_null");
    await c.call("create_entity", { kind: "object", type_id: OCUBE, name: cubeName });
    await c.call("create_entity", { kind: "object", type_id: ONULL, name: nullName });

    const cubes = await c.call<{
      entities: Array<{ name: string; type_id: number }>;
    }>("list_entities", { kind: "object", type_ids: [OCUBE], name_pattern: "^e2e_ws_" });
    expect(cubes.entities.length).toBe(1);
    expect(cubes.entities[0].name).toBe(cubeName);
    expect(cubes.entities[0].type_id).toBe(OCUBE);

    const both = await c.call<{ entities: Array<{ type_id: number }> }>("list_entities", {
      kind: "object",
      type_ids: [OCUBE, ONULL],
      name_pattern: "^e2e_ws_",
    });
    expect(both.entities.length).toBe(2);
  });

  test("list_entities include_tags returns tag info per object", async () => {
    const name = testName("ws_tagged");
    const created = await c.call<{
      handle: { kind: string; path: string; name: string };
    }>("create_entity", { kind: "object", type_id: OCUBE, name });
    await c.call("create_entity", {
      kind: "tag",
      type_id: TTEXTURE,
      parent: created.handle,
    });

    const r = await c.call<{
      entities: Array<{ name: string; tags: Array<{ type_id: number }> }>;
    }>("list_entities", {
      kind: "object",
      type_ids: [OCUBE],
      name_pattern: `^${name}$`,
      include_tags: true,
    });
    expect(r.entities.length).toBe(1);
    expect(r.entities[0].tags).toBeDefined();
    expect(r.entities[0].tags.some((t) => t.type_id === TTEXTURE)).toBe(true);
  });

  test("list_entities include_params reads specified parameter ids", async () => {
    const name = testName("ws_params");
    await c.call("create_entity", {
      kind: "object",
      type_id: OCUBE,
      name,
      position: [4, 5, 6],
    });
    const r = await c.call<{
      entities: Array<{ name: string; params: Record<string, unknown> }>;
    }>("list_entities", {
      kind: "object",
      type_ids: [OCUBE],
      name_pattern: `^${name}$`,
      include_params: [PARAM_REL_POSITION],
    });
    expect(r.entities.length).toBe(1);
    expect(r.entities[0].params).toBeDefined();
    expect(r.entities[0].params[String(PARAM_REL_POSITION)]).toEqual([4, 5, 6]);
  });

  // ---------------------------------------------------------------------
  // dump_shader
  // ---------------------------------------------------------------------

  test.skipIf(execPythonDisabled)(
    "dump_shader returns a shader tree with type_id, type_name and Xbitmap file",
    async () => {
      const matName = testName("dump_mat");
      await c.call("exec_python", {
        code: [
          "import c4d",
          "from c4d import documents",
          "doc = documents.GetActiveDocument()",
          "mat = c4d.BaseMaterial(5703)",
          `mat.SetName(${JSON.stringify(matName)})`,
          `bmp = c4d.BaseShader(${XBITMAP})`,
          `bmp[c4d.BITMAPSHADER_FILENAME] = "dummy/path/tex.png"`,
          "mat[c4d.MATERIAL_COLOR_SHADER] = bmp",
          "mat.InsertShader(bmp)",
          "doc.InsertMaterial(mat)",
          "c4d.EventAdd()",
          "result = True",
        ].join("\n"),
      });

      const r = await c.call<{
        shader: { type_id: number; type_name: string; name: string; file?: string } | null;
      }>("dump_shader", {
        handle: { kind: "shader", owner: { kind: "material", name: matName }, index: 0 },
      });
      expect(r.shader).not.toBeNull();
      expect(r.shader!.type_id).toBe(XBITMAP);
      expect(r.shader!.file).toContain("tex.png");
    },
  );

  // ---------------------------------------------------------------------
  // create_entity kind=video_post
  // ---------------------------------------------------------------------

  test("create_entity kind=video_post attaches to a render_data parent", async () => {
    const rdName = testName("vp_rd");
    await c.call("create_render_data", { name: rdName });

    const vps = await c.call<{ plugins: Array<{ id: number }> }>("list_plugins", {
      plugin_type: "video_post",
    });
    if (vps.plugins.length === 0) return; // no video_posts on this install
    const vpTypeId = vps.plugins[0].id;

    const r = await c.call<{
      handle: { kind: string; render_data: string; type_id: number };
    }>("create_entity", {
      kind: "video_post",
      type_id: vpTypeId,
      parent: { kind: "render_data", name: rdName },
    });
    expect(r.handle.kind).toBe("video_post");
    expect(r.handle.render_data).toBe(rdName);
    expect(r.handle.type_id).toBe(vpTypeId);
  });

  test("create_entity kind=video_post rejects a missing parent", async () => {
    const vps = await c.call<{ plugins: Array<{ id: number }> }>("list_plugins", {
      plugin_type: "video_post",
    });
    if (vps.plugins.length === 0) return;
    const err = await c.callExpectError("create_entity", {
      kind: "video_post",
      type_id: vps.plugins[0].id,
    });
    expect(err).toMatch(/parent|render_data/i);
  });

  test("create_entity kind=video_post rejects a non-render_data parent", async () => {
    const owner = testName("vp_wrong_parent");
    await c.call("create_entity", { kind: "object", type_id: OCUBE, name: owner });
    const vps = await c.call<{ plugins: Array<{ id: number }> }>("list_plugins", {
      plugin_type: "video_post",
    });
    if (vps.plugins.length === 0) return;
    const err = await c.callExpectError("create_entity", {
      kind: "video_post",
      type_id: vps.plugins[0].id,
      parent: { kind: "object", name: owner },
    });
    expect(err).toMatch(/render_data/i);
  });

  test.skipIf(execPythonDisabled)("dump_shader respects max_depth=0", async () => {
    const matName = testName("dump_depth");
    await c.call("exec_python", {
      code: [
        "import c4d",
        "from c4d import documents",
        "doc = documents.GetActiveDocument()",
        "mat = c4d.BaseMaterial(5703)",
        `mat.SetName(${JSON.stringify(matName)})`,
        `bmp = c4d.BaseShader(${XBITMAP})`,
        "mat[c4d.MATERIAL_COLOR_SHADER] = bmp",
        "mat.InsertShader(bmp)",
        "doc.InsertMaterial(mat)",
        "c4d.EventAdd()",
        "result = True",
      ].join("\n"),
    });
    const r = await c.call<{ shader: { type_id: number } }>("dump_shader", {
      handle: { kind: "shader", owner: { kind: "material", name: matName }, index: 0 },
      max_depth: 0,
    });
    expect(r.shader.type_id).toBe(XBITMAP);
  });
});
