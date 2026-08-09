import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { cleanupByPrefix, MCPTestClient, probeBridge, resetScene, testName } from "./harness.js";

const probe = await probeBridge("reset_scene");
const ready = probe.ready;
const client: MCPTestClient | null = probe.client ?? null;

describe.skipIf(!ready)("reset_scene", () => {
  const c = client!;

  afterAll(async () => {
    await cleanupByPrefix(c);
    await c.close();
  });

  beforeEach(async () => {
    const reset = await resetScene(c);
    if (!reset) await cleanupByPrefix(c);
  });

  test("prefix mode removes only entities matching the prefix", async () => {
    const keep = testName("keep");
    const drop = testName("drop");
    await c.call("create_entity", { kind: "object", type_id: "cube", name: keep });
    await c.call("create_entity", { kind: "object", type_id: "cube", name: drop });

    await c.call("reset_scene", { prefix: drop });

    const listed = await c.call<{ entities: Array<{ name: string }> }>("list_entities", {
      kind: "object",
    });
    const names = listed.entities.map((e) => e.name);
    expect(names).toContain(keep);
    expect(names).not.toContain(drop);
  });

  test("full reset swaps in an empty document", async () => {
    await c.call("create_entity", { kind: "object", type_id: "cube", name: testName("full") });
    await c.call("reset_scene", {});
    const listed = await c.call<{ entities: Array<{ name: string }> }>("list_entities", {
      kind: "object",
    });
    expect(listed.entities.length).toBe(0);
  });
});
