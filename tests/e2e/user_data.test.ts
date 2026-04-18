import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { cleanupByPrefix, MCPTestClient, probeBridge, resetScene, testName } from "./harness.js";

const probe = await probeBridge("user_data");
const ready = probe.ready;
const client: MCPTestClient | null = probe.client ?? null;

describe.skipIf(!ready)("user data", () => {
  const c = client!;

  afterAll(async () => {
    await cleanupByPrefix(c);
    await c.close();
  });

  beforeEach(async () => {
    const reset = await resetScene(c);
    if (!reset) await cleanupByPrefix(c);
  });

  test("add_user_data creates a real slot reachable via list + get_params", async () => {
    const name = testName("ud_real");
    await c.call("create_entity", { kind: "object", type_id: "null", name });
    const added = await c.call<{
      desc_id: unknown[];
      name: string;
      dtype: string;
    }>("add_user_data", {
      handle: { kind: "object", name },
      name: "intensity",
      dtype: "real",
      value: 0.5,
    });
    expect(added.name).toBe("intensity");
    expect(added.dtype).toBe("real");
    expect(Array.isArray(added.desc_id)).toBe(true);

    const listed = await c.call<{
      entries: Array<{ name: string; dtype: string; desc_id: unknown[]; value: unknown }>;
    }>("list_user_data", { handle: { kind: "object", name } });
    const hit = listed.entries.find((e) => e.name === "intensity");
    expect(hit).toBeDefined();
    expect(hit!.value).toBeCloseTo(0.5, 5);

    // Round-trip through the DescID path via get_params.
    const got = await c.call<{ values: Array<{ value: number }> }>("get_params", {
      handle: { kind: "object", name },
      ids: [added.desc_id as number[]],
    });
    expect(got.values[0].value).toBeCloseTo(0.5, 5);
  });

  test("remove_user_data deletes a slot; it disappears from list_user_data", async () => {
    const name = testName("ud_rm");
    await c.call("create_entity", { kind: "object", type_id: "null", name });
    const added = await c.call<{ desc_id: unknown[] }>("add_user_data", {
      handle: { kind: "object", name },
      name: "to_remove",
      dtype: "long",
      value: 7,
    });
    await c.call("remove_user_data", {
      handle: { kind: "object", name },
      desc_id: added.desc_id,
    });
    const listed = await c.call<{ entries: Array<{ name: string }> }>("list_user_data", {
      handle: { kind: "object", name },
    });
    expect(listed.entries.find((e) => e.name === "to_remove")).toBeUndefined();
  });

  test("add_user_data supports vector + bool dtypes", async () => {
    const name = testName("ud_vec");
    await c.call("create_entity", { kind: "object", type_id: "null", name });
    const vec = await c.call<{ dtype: string }>("add_user_data", {
      handle: { kind: "object", name },
      name: "origin",
      dtype: "vector",
      value: [1, 2, 3],
    });
    expect(vec.dtype).toBe("vector");

    const b = await c.call<{ dtype: string }>("add_user_data", {
      handle: { kind: "object", name },
      name: "enabled",
      dtype: "bool",
      value: true,
    });
    expect(b.dtype).toBe("bool");
  });
});
