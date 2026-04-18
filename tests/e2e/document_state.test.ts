import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { cleanupByPrefix, MCPTestClient, probeBridge, resetScene, testName } from "./harness.js";

const OCAMERA = 5103;

const probe = await probeBridge("document_state");
const ready = probe.ready;
const client: MCPTestClient | null = probe.client ?? null;

describe.skipIf(!ready)("get_document_state", () => {
  const c = client!;

  afterAll(async () => {
    await cleanupByPrefix(c);
    await c.close();
  });

  beforeEach(async () => {
    const reset = await resetScene(c);
    if (!reset) await cleanupByPrefix(c);
  });

  test("returns fps + frame range + active references in one call", async () => {
    await c.call("set_document", { fps: 30, frame_start: 0, frame_end: 48 });
    const r = await c.call<{
      fps: number;
      frame_start: number;
      frame_end: number;
      current_frame: number;
      active_camera: { name: string } | null;
      active_take: { name: string } | null;
      active_render_data: { name: string } | null;
      document_name: string;
      document_path: string;
    }>("get_document_state");

    expect(r.fps).toBe(30);
    expect(r.frame_start).toBe(0);
    expect(r.frame_end).toBe(48);
    expect(typeof r.current_frame).toBe("number");
    expect(r.active_take).toBeTruthy();
    expect(r.active_render_data).toBeTruthy();
  });

  test("reflects an active_camera set via set_document", async () => {
    const camName = testName("dstate_cam");
    await c.call("create_entity", { kind: "object", type_id: OCAMERA, name: camName });
    await c.call("set_document", { active_camera: camName });
    const r = await c.call<{ active_camera: { name: string } | null }>("get_document_state");
    expect(r.active_camera?.name).toBe(camName);
  });
});
