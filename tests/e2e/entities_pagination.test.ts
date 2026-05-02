import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { cleanupByPrefix, MCPTestClient, probeBridge, resetScene, testName } from "./harness.js";

const OCUBE = 5159;
const ONULL = 5140;

const probe = await probeBridge("entities_pagination");
const ready = probe.ready;
const client: MCPTestClient | null = probe.client ?? null;

describe.skipIf(!ready)("list_entities pagination / subtree / summary", () => {
  const c = client!;

  afterAll(async () => {
    await cleanupByPrefix(c);
    await c.close();
  });

  beforeEach(async () => {
    const reset = await resetScene(c);
    if (!reset) await cleanupByPrefix(c);
  });

  test("offset + limit slices the listing and reports total", async () => {
    for (let i = 0; i < 8; i++) {
      await c.call("create_entity", {
        kind: "object",
        type_id: OCUBE,
        name: testName(`page_${i.toString().padStart(2, "0")}`),
      });
    }

    const page1 = await c.call<{
      entities: Array<{ name: string }>;
      total: number;
      offset: number;
      limit: number;
    }>("list_entities", {
      kind: "object",
      name_pattern: "^e2e_page_",
      offset: 0,
      limit: 3,
    });
    expect(page1.total).toBe(8);
    expect(page1.offset).toBe(0);
    expect(page1.limit).toBe(3);
    expect(page1.entities.length).toBe(3);

    const page2 = await c.call<{ entities: Array<{ name: string }>; total: number }>(
      "list_entities",
      { kind: "object", name_pattern: "^e2e_page_", offset: 3, limit: 3 },
    );
    expect(page2.total).toBe(8);
    expect(page2.entities.length).toBe(3);
    // No overlap between the two pages.
    const overlap = page1.entities
      .map((e) => e.name)
      .filter((n) => page2.entities.some((e) => e.name === n));
    expect(overlap).toEqual([]);
  });

  test("kind=object with object_path lists only the subtree", async () => {
    const root = testName("sub_root");
    const sib = testName("sub_sibling");
    await c.call("create_entity", { kind: "object", type_id: ONULL, name: root });
    await c.call("create_entity", { kind: "object", type_id: ONULL, name: sib });
    await c.call("create_entity", {
      kind: "object",
      type_id: OCUBE,
      name: testName("sub_child_a"),
      parent: { kind: "object", name: root },
    });
    await c.call("create_entity", {
      kind: "object",
      type_id: OCUBE,
      name: testName("sub_child_b"),
      parent: { kind: "object", name: root },
    });
    await c.call("create_entity", {
      kind: "object",
      type_id: OCUBE,
      name: testName("sub_outsider"),
      parent: { kind: "object", name: sib },
    });

    const r = await c.call<{
      entities: Array<{ name: string; depth: number }>;
      total: number;
    }>("list_entities", {
      kind: "object",
      object_path: `/${root}`,
    });
    const names = r.entities.map((e) => e.name);
    expect(names).toContain(root);
    expect(names).toContain(testName("sub_child_a"));
    expect(names).toContain(testName("sub_child_b"));
    expect(names).not.toContain(sib);
    expect(names).not.toContain(testName("sub_outsider"));
  });

  test("summary_only returns counts without per-entity entries", async () => {
    for (let i = 0; i < 5; i++) {
      await c.call("create_entity", {
        kind: "object",
        type_id: OCUBE,
        name: testName(`sum_cube_${i}`),
      });
    }
    for (let i = 0; i < 2; i++) {
      await c.call("create_entity", {
        kind: "object",
        type_id: ONULL,
        name: testName(`sum_null_${i}`),
      });
    }

    const r = await c.call<{
      summary: {
        total: number;
        by_type: Record<string, number>;
        by_depth?: Record<string, number>;
      };
      total: number;
      entities?: unknown;
    }>("list_entities", {
      kind: "object",
      name_pattern: "^e2e_sum_",
      summary_only: true,
    });
    expect(r.summary.total).toBe(7);
    expect(r.summary.by_type[String(OCUBE)]).toBe(5);
    expect(r.summary.by_type[String(ONULL)]).toBe(2);
    expect(r.entities).toBeUndefined();
  });

  test("unknown subtree path raises a clear error", async () => {
    const err = await c.callExpectError("list_entities", {
      kind: "object",
      object_path: "/this/does/not/exist",
    });
    expect(err).toMatch(/not found/i);
  });

  test("offset >= total returns an empty page but accurate total", async () => {
    for (let i = 0; i < 3; i++) {
      await c.call("create_entity", {
        kind: "object",
        type_id: OCUBE,
        name: testName(`bound_${i}`),
      });
    }
    const r = await c.call<{
      entities: Array<{ name: string }>;
      total: number;
      offset: number;
    }>("list_entities", {
      kind: "object",
      name_pattern: "^e2e_bound_",
      offset: 100,
      limit: 5,
    });
    expect(r.total).toBe(3);
    expect(r.offset).toBe(100);
    expect(r.entities).toEqual([]);
  });

  test("summary_only respects subtree filter", async () => {
    const root = testName("subsum_root");
    await c.call("create_entity", { kind: "object", type_id: ONULL, name: root });
    await c.call("create_entity", {
      kind: "object",
      type_id: OCUBE,
      name: testName("subsum_in_a"),
      parent: { kind: "object", name: root },
    });
    await c.call("create_entity", {
      kind: "object",
      type_id: OCUBE,
      name: testName("subsum_in_b"),
      parent: { kind: "object", name: root },
    });
    // Outside the subtree.
    await c.call("create_entity", {
      kind: "object",
      type_id: OCUBE,
      name: testName("subsum_out"),
    });

    const r = await c.call<{
      summary: { total: number; by_type: Record<string, number> };
      total: number;
    }>("list_entities", {
      kind: "object",
      object_path: `/${root}`,
      summary_only: true,
    });
    // Subtree contains the root null + 2 cubes = 3 objects.
    expect(r.summary.total).toBe(3);
    expect(r.summary.by_type[String(OCUBE)]).toBe(2);
    expect(r.summary.by_type[String(ONULL)]).toBe(1);
  });

  test("limit caps entries when total exceeds the page size", async () => {
    for (let i = 0; i < 12; i++) {
      await c.call("create_entity", {
        kind: "object",
        type_id: OCUBE,
        name: testName(`cap_${i.toString().padStart(2, "0")}`),
      });
    }
    const r = await c.call<{
      entities: Array<{ name: string }>;
      total: number;
      limit: number;
    }>("list_entities", {
      kind: "object",
      name_pattern: "^e2e_cap_",
      limit: 5,
    });
    expect(r.total).toBe(12);
    expect(r.limit).toBe(5);
    expect(r.entities.length).toBe(5);
  });
});
