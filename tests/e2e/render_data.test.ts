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
});
