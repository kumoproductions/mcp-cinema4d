import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { cleanupByPrefix, MCPTestClient, probeBridge, resetScene, testName } from "./harness.js";

const OCUBE = 5159;
const ONULL = 5140;
const OCAMERA = 5103;

const probe = await probeBridge("hierarchy");
const ready = probe.ready;
const client: MCPTestClient | null = probe.client ?? null;

describe.skipIf(!ready)("hierarchy (move/clone)", () => {
  const c = client!;

  afterAll(async () => {
    await cleanupByPrefix(c);
    await c.close();
  });

  beforeEach(async () => {
    const reset = await resetScene(c);
    if (!reset) await cleanupByPrefix(c);
  });

  // ---------------------------------------------------------------------
  // move_entity — reparent + reorder
  // ---------------------------------------------------------------------

  test("move_entity reparents an object under a null", async () => {
    const parent = testName("mv_parent");
    const child = testName("mv_child");
    await c.call("create_entity", { kind: "object", type_id: ONULL, name: parent });
    await c.call("create_entity", { kind: "object", type_id: OCUBE, name: child });

    const r = await c.call<{ handle: { path: string } }>("move_entity", {
      handle: { kind: "object", name: child },
      parent: { kind: "object", name: parent },
    });
    expect(r.handle.path).toBe(`/${parent}/${child}`);
  });

  test("move_entity to root (parent=null)", async () => {
    const parent = testName("unroot_parent");
    const child = testName("unroot_child");
    await c.call("create_entity", { kind: "object", type_id: ONULL, name: parent });
    await c.call("create_entity", {
      kind: "object",
      type_id: OCUBE,
      name: child,
      parent: { kind: "object", name: parent },
    });

    const r = await c.call<{ handle: { path: string } }>("move_entity", {
      handle: { kind: "object", path: `/${parent}/${child}` },
      to_root: true,
    });
    expect(r.handle.path).toBe(`/${child}`);
  });

  test("move_entity before sibling reorders", async () => {
    const a = testName("order_a");
    const b = testName("order_b");
    await c.call("create_entity", { kind: "object", type_id: OCUBE, name: a });
    await c.call("create_entity", { kind: "object", type_id: OCUBE, name: b });

    // Move b before a → scene order becomes [b, a].
    await c.call("move_entity", {
      handle: { kind: "object", name: b },
      before: { kind: "object", name: a },
    });
    const r = await c.call<{ entities: Array<{ name: string; depth: number }> }>("list_entities", {
      kind: "object",
      name_pattern: "^e2e_order_",
      max_depth: 0,
    });
    const topNames = r.entities.map((o) => o.name);
    expect(topNames).toEqual([b, a]);
  });

  test("move_entity after sibling reorders", async () => {
    const a = testName("ord2_a");
    const b = testName("ord2_b");
    await c.call("create_entity", { kind: "object", type_id: OCUBE, name: a });
    await c.call("create_entity", { kind: "object", type_id: OCUBE, name: b });

    // Move a after b → scene order becomes [b, a].
    await c.call("move_entity", {
      handle: { kind: "object", name: a },
      after: { kind: "object", name: b },
    });
    const r = await c.call<{ entities: Array<{ name: string; depth: number }> }>("list_entities", {
      kind: "object",
      name_pattern: "^e2e_ord2_",
      max_depth: 0,
    });
    const topNames = r.entities.map((o) => o.name);
    expect(topNames).toEqual([b, a]);
  });

  // ---------------------------------------------------------------------
  // move_entity — takes
  // ---------------------------------------------------------------------

  test("move_entity reparents a take under another take", async () => {
    const parent = testName("mvT_parent");
    const child = testName("mvT_child");
    await c.call("create_take", { name: parent });
    await c.call("create_take", { name: child });

    const r = await c.call<{ handle: { kind: string; name: string } }>("move_entity", {
      handle: { kind: "take", name: child },
      parent: { kind: "take", name: parent },
    });
    expect(r.handle.kind).toBe("take");

    const listed = await c.call<{
      entities: Array<{ name: string; parent: string | null }>;
    }>("list_entities", { kind: "take", name_pattern: `^${child}$` });
    expect(listed.entities[0].parent).toBe(parent);
  });

  test("move_entity to_root reparents a take under Main", async () => {
    const parent = testName("mvTroot_parent");
    const child = testName("mvTroot_child");
    await c.call("create_take", { name: parent });
    await c.call("create_take", { name: child, parent });

    await c.call("move_entity", {
      handle: { kind: "take", name: child },
      to_root: true,
    });

    const listed = await c.call<{
      entities: Array<{ name: string; parent: string | null; is_main: boolean }>;
    }>("list_entities", { kind: "take", name_pattern: `^${child}$` });
    expect(listed.entities[0].is_main).toBe(false);
    // Main's name is locale-dependent, so we just assert the parent is the
    // (single) main take rather than hard-coding "Main".
    const main = await c.call<{
      entities: Array<{ name: string; is_main: boolean }>;
    }>("list_entities", { kind: "take" });
    const mainName = main.entities.find((e) => e.is_main)?.name;
    expect(listed.entities[0].parent).toBe(mainName);
  });

  test("move_entity rejects moving the Main take", async () => {
    const main = await c.call<{ entities: Array<{ name: string; is_main: boolean }> }>(
      "list_entities",
      { kind: "take" },
    );
    const mainName = main.entities.find((e) => e.is_main)!.name;
    const sib = testName("mvT_sibling");
    await c.call("create_take", { name: sib });
    const err = await c.callExpectError("move_entity", {
      handle: { kind: "take", name: mainName },
      after: { kind: "take", name: sib },
    });
    expect(err).toMatch(/main take/i);
  });

  // ---------------------------------------------------------------------
  // move_entity — render_data
  // ---------------------------------------------------------------------

  test("move_entity reparents a render_data under another render_data", async () => {
    const parent = testName("mvRD_parent");
    const child = testName("mvRD_child");
    await c.call("create_render_data", { name: parent });
    await c.call("create_render_data", { name: child });

    await c.call("move_entity", {
      handle: { kind: "render_data", name: child },
      parent: { kind: "render_data", name: parent },
    });

    const listed = await c.call<{
      entities: Array<{ name: string; parent: string | null; depth: number }>;
    }>("list_entities", { kind: "render_data", name_pattern: `^${child}$` });
    expect(listed.entities[0].parent).toBe(parent);
    expect(listed.entities[0].depth).toBe(1);
  });

  test("move_entity to_root promotes a child render_data to top level", async () => {
    const parent = testName("mvRDroot_p");
    const child = testName("mvRDroot_c");
    await c.call("create_render_data", { name: parent });
    await c.call("create_render_data", { name: child, parent });

    await c.call("move_entity", {
      handle: { kind: "render_data", name: child },
      to_root: true,
    });

    const listed = await c.call<{
      entities: Array<{ name: string; parent: string | null; depth: number }>;
    }>("list_entities", { kind: "render_data", name_pattern: `^${child}$` });
    expect(listed.entities[0].parent).toBe(null);
    expect(listed.entities[0].depth).toBe(0);
  });

  test("move_entity rejects mismatched kinds", async () => {
    const t = testName("mix_take");
    const rd = testName("mix_rd");
    await c.call("create_take", { name: t });
    await c.call("create_render_data", { name: rd });

    const err = await c.callExpectError("move_entity", {
      handle: { kind: "take", name: t },
      parent: { kind: "render_data", name: rd },
    });
    expect(err).toMatch(/BaseTake|RenderData|did not resolve/i);
  });

  // ---------------------------------------------------------------------
  // clone_entity
  // ---------------------------------------------------------------------

  test("clone_entity duplicates an object with a new name", async () => {
    const src = testName("clone_src");
    const dst = testName("clone_dst");
    await c.call("create_entity", {
      kind: "object",
      type_id: OCUBE,
      name: src,
      position: [1, 2, 3],
    });

    const r = await c.call<{ handle: { kind: string; path: string; name: string } }>(
      "clone_entity",
      {
        handle: { kind: "object", name: src },
        name: dst,
      },
    );
    expect(r.handle.kind).toBe("object");
    expect(r.handle.name).toBe(dst);
    expect(r.handle.path).toBe(`/${dst}`);

    // Verify the original still exists (clone != move).
    const listed = await c.call<{ entities: Array<{ name: string }> }>("list_entities", {
      kind: "object",
      name_pattern: `^${src}$`,
    });
    expect(listed.entities.length).toBe(1);
  });

  test("clone_entity places the copy under a specified parent", async () => {
    const src = testName("cparent_src");
    const host = testName("cparent_host");
    await c.call("create_entity", { kind: "object", type_id: OCUBE, name: src });
    await c.call("create_entity", { kind: "object", type_id: ONULL, name: host });

    const r = await c.call<{ handle: { path: string; name: string } }>("clone_entity", {
      handle: { kind: "object", name: src },
      parent: { kind: "object", name: host },
    });
    expect(r.handle.path.startsWith(`/${host}/`)).toBe(true);
  });

  test("clone_entity on material duplicates it into the document", async () => {
    const MAT_STANDARD = 5703;
    const src = testName("matclone_src");
    await c.call("create_entity", { kind: "material", type_id: MAT_STANDARD, name: src });

    const r = await c.call<{ handle: { kind: string; name: string } }>("clone_entity", {
      handle: { kind: "material", name: src },
      name: testName("matclone_dst"),
    });
    expect(r.handle.kind).toBe("material");
    expect(r.handle.name).toBe(testName("matclone_dst"));
  });

  test("clone_entity on render_data duplicates into the document", async () => {
    const src = testName("rdclone_src");
    const dst = testName("rdclone_dst");
    await c.call("create_render_data", { name: src, width: 320, height: 240 });

    const r = await c.call<{ handle: { kind: string; name: string } }>("clone_entity", {
      handle: { kind: "render_data", name: src },
      name: dst,
    });
    expect(r.handle.kind).toBe("render_data");
    expect(r.handle.name).toBe(dst);

    const listed = await c.call<{ entities: Array<{ name: string }> }>("list_entities", {
      kind: "render_data",
      name_pattern: "^e2e_rdclone_",
    });
    const names = listed.entities.map((e) => e.name).toSorted();
    expect(names).toEqual([dst, src].toSorted());
  });

  test("clone_entity on video_post duplicates within the source render_data", async () => {
    const rd = testName("vpclone_rd");
    await c.call("create_render_data", { name: rd });

    // Pick any available video_post plugin for this C4D build (Cell, AO, …).
    const vps = await c.call<{ plugins: Array<{ id: number }> }>("list_plugins", {
      plugin_type: "video_post",
    });
    if (vps.plugins.length === 0) return; // no video_posts on this install
    const vpTypeId = vps.plugins[0].id;

    await c.call("create_entity", {
      kind: "video_post",
      type_id: vpTypeId,
      parent: { kind: "render_data", name: rd },
    });
    const cloned = await c.call<{
      handle: { kind: string; render_data: string; type_id: number };
    }>("clone_entity", {
      handle: { kind: "video_post", render_data: rd, type_id: vpTypeId },
    });
    expect(cloned.handle.kind).toBe("video_post");
    expect(cloned.handle.render_data).toBe(rd);
    expect(cloned.handle.type_id).toBe(vpTypeId);
  });

  test("clone_entity on video_post places the copy in an explicit render_data", async () => {
    const src = testName("vpxrd_src");
    const dst = testName("vpxrd_dst");
    await c.call("create_render_data", { name: src });
    await c.call("create_render_data", { name: dst });

    const vps = await c.call<{ plugins: Array<{ id: number }> }>("list_plugins", {
      plugin_type: "video_post",
    });
    if (vps.plugins.length === 0) return;
    const vpTypeId = vps.plugins[0].id;

    await c.call("create_entity", {
      kind: "video_post",
      type_id: vpTypeId,
      parent: { kind: "render_data", name: src },
    });
    const cloned = await c.call<{ handle: { render_data: string } }>("clone_entity", {
      handle: { kind: "video_post", render_data: src, type_id: vpTypeId },
      parent: { kind: "render_data", name: dst },
    });
    expect(cloned.handle.render_data).toBe(dst);
  });

  test("clone_entity on take copies overrides via AddTake", async () => {
    const cam = testName("tclone_cam");
    const src = testName("tclone_src");
    const dst = testName("tclone_dst");
    await c.call("create_entity", { kind: "object", type_id: OCAMERA, name: cam });
    await c.call("create_take", { name: src, camera: cam });

    const r = await c.call<{ handle: { kind: string; name: string } }>("clone_entity", {
      handle: { kind: "take", name: src },
      name: dst,
    });
    expect(r.handle.kind).toBe("take");
    expect(r.handle.name).toBe(dst);

    const listed = await c.call<{ entities: Array<{ name: string }> }>("list_entities", {
      kind: "take",
      name_pattern: "^e2e_tclone_",
    });
    expect(listed.entities.map((e) => e.name).toSorted()).toEqual([dst, src].toSorted());
  });

  test("clone_entity on take inherits the source's overrides", async () => {
    const PARAM_REL_POSITION = 903;
    const cam = testName("tinh_cam");
    const src = testName("tinh_src");
    const dst = testName("tinh_dst");
    await c.call("create_entity", { kind: "object", type_id: OCAMERA, name: cam });
    await c.call("create_take", { name: src, camera: cam });

    // Seed an override on the source take and confirm it actually took effect.
    await c.call("take_override", {
      take: src,
      target: { kind: "object", name: cam },
      values: [{ path: PARAM_REL_POSITION, value: [11, 22, 33] }],
    });
    await c.call("set_document", { active_take: src });
    const seeded = await c.call<{ values: Array<{ value: number[] }> }>("get_params", {
      handle: { kind: "object", name: cam },
      ids: [PARAM_REL_POSITION],
    });
    expect(seeded.values[0].value).toEqual([11, 22, 33]);

    // Clone should copy overrides — activating the clone must surface the
    // same value without a fresh take_override call.
    await c.call("clone_entity", {
      handle: { kind: "take", name: src },
      name: dst,
    });
    await c.call("set_document", { active_take: dst });
    const inherited = await c.call<{ values: Array<{ value: number[] }> }>("get_params", {
      handle: { kind: "object", name: cam },
      ids: [PARAM_REL_POSITION],
    });
    expect(inherited.values[0].value).toEqual([11, 22, 33]);
  });

  test("clone_entity on take places the copy under an explicit parent take", async () => {
    const parent = testName("tparent_parent");
    const src = testName("tparent_src");
    const dst = testName("tparent_dst");
    await c.call("create_take", { name: parent });
    await c.call("create_take", { name: src });

    const r = await c.call<{ handle: { kind: string; name: string } }>("clone_entity", {
      handle: { kind: "take", name: src },
      name: dst,
      parent: { kind: "take", name: parent },
    });
    expect(r.handle.name).toBe(dst);

    // Confirm the clone lives one level below the named parent (depth > 0).
    const listed = await c.call<{
      entities: Array<{ name: string; depth: number }>;
    }>("list_entities", { kind: "take", name_pattern: `^${dst}$` });
    expect(listed.entities.length).toBe(1);
    expect(listed.entities[0].depth).toBeGreaterThan(0);
  });
});
