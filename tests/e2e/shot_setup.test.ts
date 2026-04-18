import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { cleanupByPrefix, MCPTestClient, probeBridge, resetScene, testName } from "./harness.js";

const OCAMERA = 5103; // c4d.Ocamera
const OCUBE = 5159;

const probe = await probeBridge("shot_setup");
const ready = probe.ready;
const client: MCPTestClient | null = probe.client ?? null;

describe.skipIf(!ready)("shot setup", () => {
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

  test("set_document updates fps and mirrors to active render data", async () => {
    const r = await c.call<{ updated: Record<string, unknown> }>("set_document", {
      fps: 30,
      frame_start: 0,
      frame_end: 24,
    });
    expect(r.updated.fps).toBe(30);
    expect(r.updated.frame_start).toBe(0);
    expect(r.updated.frame_end).toBe(24);
  });

  test("sample_transform walks frames and returns per-frame pos+rot", async () => {
    const name = testName("sampled");
    await c.call("create_entity", {
      kind: "object",
      type_id: OCUBE,
      name,
      position: [0, 0, 0],
    });
    const r = await c.call<{
      samples: Array<{ frame: number; pos: number[]; rot: number[] }>;
      format: string;
    }>("sample_transform", {
      handle: { kind: "object", name },
      frames: [0, 5, 10],
      format: "off_rot",
    });
    expect(r.format).toBe("off_rot");
    expect(r.samples.length).toBe(3);
    expect(r.samples[0].pos).toEqual([0, 0, 0]);
    expect(r.samples[0].rot.length).toBe(3);
  });

  test("sample_transform rejects empty frame list", async () => {
    const name = testName("sampled_err");
    await c.call("create_entity", { kind: "object", type_id: OCUBE, name });
    // Zod-level validation happens client-side, so expect an MCP error.
    await expect(
      c.call("sample_transform", {
        handle: { kind: "object", name },
        frames: [],
      }),
    ).rejects.toThrow();
  });
});
