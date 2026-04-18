import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { cleanupByPrefix, MCPTestClient, probeBridge, resetScene, testName } from "./harness.js";

const OCUBE = 5159;
const OPOLYGON = 5100; // c4d.Opolygon

const probe = await probeBridge("modeling");
const ready = probe.ready;
const client: MCPTestClient | null = probe.client ?? null;

describe.skipIf(!ready)("modeling_command", () => {
  const c = client!;

  afterAll(async () => {
    await cleanupByPrefix(c);
    await c.close();
  });

  beforeEach(async () => {
    const reset = await resetScene(c);
    if (!reset) await cleanupByPrefix(c);
  });

  test("current_state_to_object on a cube yields a polygon object", async () => {
    const name = testName("cso_src");
    await c.call("create_entity", { kind: "object", type_id: OCUBE, name });

    const r = await c.call<{
      ok: boolean;
      results: Array<{ kind: string; path: string; name: string; type_id: number }>;
    }>("modeling_command", {
      command: "current_state_to_object",
      targets: [{ kind: "object", name }],
    });
    expect(r.ok).toBe(true);
    expect(r.results.length).toBeGreaterThan(0);
    expect(r.results[0].type_id).toBe(OPOLYGON);
  });

  // Note: MAKEEDITABLE's SendModelingCommand behaviour is wildly
  // inconsistent across 2024/2025/2026 (different builds return True, new
  // objects, or neither, and sometimes drop the source without inserting a
  // replacement). CSO is the reliable conversion path — covered above —
  // so we don't assert on make_editable in isolation. Callers should use
  // `current_state_to_object` when they need a guaranteed polygon copy.

  test("modeling_command rejects unknown command aliases", async () => {
    const name = testName("unknown_cmd");
    await c.call("create_entity", { kind: "object", type_id: OCUBE, name });

    const err = await c.callExpectError("modeling_command", {
      command: "definitely_not_a_command",
      targets: [{ kind: "object", name }],
    });
    expect(err).toMatch(/unknown/i);
  });
});
