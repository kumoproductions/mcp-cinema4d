import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { cleanupByPrefix, MCPTestClient, probeBridge, resetScene, testName } from "./harness.js";

const OCUBE = 5159;
const ONULL = 5140;

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
});
