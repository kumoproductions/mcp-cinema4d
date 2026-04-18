import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { cleanupByPrefix, MCPTestClient, probeBridge, resetScene, testName } from "./harness.js";

const OCUBE = 5159;
const MAT_STANDARD = 5703;
const TTEXTURE = 5616;

const probe = await probeBridge("tags");
const ready = probe.ready;
const client: MCPTestClient | null = probe.client ?? null;

describe.skipIf(!ready)("tag helpers (assign_material)", () => {
  const c = client!;

  afterAll(async () => {
    await cleanupByPrefix(c);
    await c.close();
  });

  beforeEach(async () => {
    const reset = await resetScene(c);
    if (!reset) await cleanupByPrefix(c);
  });

  test("assign_material links a material via a new Texture tag", async () => {
    const objName = testName("am_obj");
    const matName = testName("am_mat");
    await c.call("create_entity", { kind: "object", type_id: OCUBE, name: objName });
    await c.call("create_entity", { kind: "material", type_id: MAT_STANDARD, name: matName });

    const r = await c.call<{
      tag: { kind: string; object: string; type_id: number; tag_name: string };
      created: boolean;
    }>("assign_material", {
      object: { kind: "object", name: objName },
      material: { kind: "material", name: matName },
    });
    expect(r.created).toBe(true);
    expect(r.tag.type_id).toBe(TTEXTURE);

    // Verify a texture tag exists on the object.
    const listed = await c.call<{
      entities: Array<{ type_id: number; object: string }>;
    }>("list_entities", { kind: "tag", object: objName });
    expect(listed.entities.some((t) => t.type_id === TTEXTURE)).toBe(true);
  });

  test("assign_material with update_if_exists updates the existing texture tag in place", async () => {
    const objName = testName("ar_obj");
    const mat1 = testName("ar_mat1");
    const mat2 = testName("ar_mat2");
    await c.call("create_entity", { kind: "object", type_id: OCUBE, name: objName });
    await c.call("create_entity", { kind: "material", type_id: MAT_STANDARD, name: mat1 });
    await c.call("create_entity", { kind: "material", type_id: MAT_STANDARD, name: mat2 });

    await c.call("assign_material", {
      object: { kind: "object", name: objName },
      material: { kind: "material", name: mat1 },
    });
    const r = await c.call<{ created: boolean }>("assign_material", {
      object: { kind: "object", name: objName },
      material: { kind: "material", name: mat2 },
      update_if_exists: true,
    });
    expect(r.created).toBe(false);

    // Still exactly one texture tag on the object.
    const listed = await c.call<{ entities: Array<{ type_id: number }> }>("list_entities", {
      kind: "tag",
      object: objName,
    });
    const texTags = listed.entities.filter((t) => t.type_id === TTEXTURE);
    expect(texTags.length).toBe(1);
  });

  test("assign_material accepts projection alias", async () => {
    const objName = testName("ap_obj");
    const matName = testName("ap_mat");
    await c.call("create_entity", { kind: "object", type_id: OCUBE, name: objName });
    await c.call("create_entity", { kind: "material", type_id: MAT_STANDARD, name: matName });

    const r = await c.call<{
      projection: { alias: string; value: number };
    }>("assign_material", {
      object: { kind: "object", name: objName },
      material: { kind: "material", name: matName },
      projection: "spherical",
    });
    expect(r.projection.alias).toBe("spherical");
    expect(typeof r.projection.value).toBe("number");
  });

  test("assign_material rejects an unknown projection alias", async () => {
    const objName = testName("apf_obj");
    const matName = testName("apf_mat");
    await c.call("create_entity", { kind: "object", type_id: OCUBE, name: objName });
    await c.call("create_entity", { kind: "material", type_id: MAT_STANDARD, name: matName });

    // TS-side zod enum rejects the unknown alias before the call reaches
    // the bridge. Accept either error source.
    const err = await c.callExpectError("assign_material", {
      object: { kind: "object", name: objName },
      material: { kind: "material", name: matName },
      projection: "holographic_gibberish",
    });
    expect(err).toMatch(/unknown projection|invalid option|holographic_gibberish/i);
  });
});
