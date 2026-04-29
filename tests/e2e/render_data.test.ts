import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { cleanupByPrefix, MCPTestClient, probeBridge, resetScene, testName } from "./harness.js";

const probe = await probeBridge("render_data");
const ready = probe.ready;
const client: MCPTestClient | null = probe.client ?? null;

describe.skipIf(!ready)("render_data", () => {
  const c = client!;

  afterAll(async () => {
    await cleanupByPrefix(c);
    await c.close();
  });

  beforeEach(async () => {
    const reset = await resetScene(c);
    if (!reset) await cleanupByPrefix(c);
  });

  test("create_render_data creates a named render data with resolution + renderer alias", async () => {
    const name = testName("rd");
    const r = await c.call<{ handle: { kind: string; name: string }; created: boolean }>(
      "create_render_data",
      {
        name,
        width: 640,
        height: 360,
        renderer: "standard",
        fps: 30,
        frame_start: 0,
        frame_end: 48,
      },
    );
    expect(r.handle.kind).toBe("render_data");
    expect(r.handle.name).toBe(name);
    expect(r.created).toBe(true);

    const listed = await c.call<{ entities: Array<{ name: string; is_active: boolean }> }>(
      "list_entities",
      { kind: "render_data", name_pattern: `^${name}$` },
    );
    expect(listed.entities.length).toBe(1);
  });

  test("create_render_data is idempotent with update_if_exists", async () => {
    const name = testName("rd_upd");
    const first = await c.call<{ created: boolean }>("create_render_data", { name });
    expect(first.created).toBe(true);
    const second = await c.call<{ created: boolean }>("create_render_data", {
      name,
      width: 1920,
      update_if_exists: true,
    });
    expect(second.created).toBe(false);
  });

  test("create_render_data nests under an existing parent render_data", async () => {
    const parent = testName("rd_parent");
    const child = testName("rd_child");
    await c.call("create_render_data", { name: parent });
    const r = await c.call<{ created: boolean; handle: { name: string } }>("create_render_data", {
      name: child,
      parent,
    });
    expect(r.created).toBe(true);
    expect(r.handle.name).toBe(child);

    const listed = await c.call<{
      entities: Array<{ name: string; depth: number; parent: string | null }>;
    }>("list_entities", { kind: "render_data", name_pattern: "^e2e_rd_(parent|child)$" });
    const byName = new Map(listed.entities.map((e) => [e.name, e]));
    expect(byName.get(parent)?.depth).toBe(0);
    expect(byName.get(parent)?.parent).toBe(null);
    expect(byName.get(child)?.depth).toBe(1);
    expect(byName.get(child)?.parent).toBe(parent);
  });

  test("create_render_data with unknown parent rejects clearly", async () => {
    const err = await c.callExpectError("create_render_data", {
      name: testName("rd_orphan"),
      parent: testName("rd_404_parent"),
    });
    expect(err).toMatch(/parent render_data not found/i);
  });

  test("child render_data resolves by name and accepts param updates", async () => {
    const parent = testName("rd_p_ref");
    const child = testName("rd_c_ref");
    await c.call("create_render_data", { name: parent });
    await c.call("create_render_data", { name: child, parent });

    // _find_render_data must walk the tree, not just the top-level siblings.
    const r = await c.call<{ created: boolean }>("create_render_data", {
      name: child,
      width: 1280,
      height: 720,
      update_if_exists: true,
    });
    expect(r.created).toBe(false);
  });

  test("clone_entity on render_data accepts a parent and nests the copy", async () => {
    const root = testName("rd_clone_root");
    const src = testName("rd_clone_src");
    const dst = testName("rd_clone_dst");
    await c.call("create_render_data", { name: root });
    await c.call("create_render_data", { name: src });

    const r = await c.call<{ handle: { kind: string; name: string } }>("clone_entity", {
      handle: { kind: "render_data", name: src },
      name: dst,
      parent: { kind: "render_data", name: root },
    });
    expect(r.handle.name).toBe(dst);

    const listed = await c.call<{
      entities: Array<{ name: string; parent: string | null; depth: number }>;
    }>("list_entities", { kind: "render_data", name_pattern: `^${dst}$` });
    expect(listed.entities.length).toBe(1);
    expect(listed.entities[0].parent).toBe(root);
    expect(listed.entities[0].depth).toBe(1);
  });
});
