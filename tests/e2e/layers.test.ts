import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { cleanupByPrefix, MCPTestClient, probeBridge, resetScene, testName } from "./harness.js";

const OCUBE = 5159;

const probe = await probeBridge("layers");
const ready = probe.ready;
const client: MCPTestClient | null = probe.client ?? null;

describe.skipIf(!ready)("layers", () => {
  const c = client!;

  afterAll(async () => {
    await cleanupByPrefix(c);
    await c.close();
  });

  beforeEach(async () => {
    const reset = await resetScene(c);
    if (!reset) await cleanupByPrefix(c);
  });

  test("create_layer + list_layers round-trip", async () => {
    const layerName = testName("ly_basic");
    const r = await c.call<{ handle: { name: string }; created: boolean }>("create_layer", {
      name: layerName,
      color: [0.5, 0.25, 0.1],
    });
    expect(r.created).toBe(true);
    expect(r.handle.name).toBe(layerName);

    const listed = await c.call<{
      layers: Array<{ name: string; color?: number[] }>;
    }>("list_layers");
    const found = listed.layers.find((l) => l.name === layerName);
    expect(found).toBeDefined();
  });

  test("assign_to_layer places object on the named layer; null clears it", async () => {
    const layerName = testName("ly_assign");
    const objName = testName("ly_obj");
    await c.call("create_layer", { name: layerName });
    await c.call("create_entity", { kind: "object", type_id: OCUBE, name: objName });

    await c.call("assign_to_layer", {
      target: { kind: "object", name: objName },
      layer: layerName,
    });
    // Verify via list_layers showing assignment (scan object list on the layer).
    const r = await c.call<{
      layer: { name: string } | null;
    }>("get_object_layer", { target: { kind: "object", name: objName } });
    expect(r.layer?.name).toBe(layerName);

    await c.call("assign_to_layer", {
      target: { kind: "object", name: objName },
      layer: null,
    });
    const r2 = await c.call<{ layer: unknown }>("get_object_layer", {
      target: { kind: "object", name: objName },
    });
    expect(r2.layer).toBeNull();
  });

  test("set_layer_flags updates visibility / render flags", async () => {
    const layerName = testName("ly_flags");
    await c.call("create_layer", { name: layerName });
    const r = await c.call<{
      flags: { view: boolean; render: boolean; locked: boolean };
    }>("set_layer_flags", {
      layer: layerName,
      view: false,
      render: false,
      locked: true,
    });
    expect(r.flags.view).toBe(false);
    expect(r.flags.render).toBe(false);
    expect(r.flags.locked).toBe(true);
  });
});
