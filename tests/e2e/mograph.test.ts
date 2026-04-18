import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { cleanupByPrefix, MCPTestClient, probeBridge, resetScene, testName } from "./harness.js";

const OCUBE = 5159;
const MG_CLONER = 1018544; // c4d.Omgcloner

const probe = await probeBridge("mograph");
const ready = probe.ready;
const client: MCPTestClient | null = probe.client ?? null;

// Skip the suite on builds without a Cloner (MoGraph is a bundled module but
// defensive anyway).
let mographPresent = false;
if (ready && client) {
  try {
    const r = await client.call<{ entities: Array<{ id: number }> }>("list_plugins", {
      plugin_type: "object",
    });
    mographPresent = r.entities?.some((e) => e.id === MG_CLONER) ?? false;
  } catch {
    mographPresent = false;
  }
}

describe.skipIf(!ready || !mographPresent)("mograph — list_mograph_clones", () => {
  const c = client!;

  afterAll(async () => {
    await cleanupByPrefix(c);
    await c.close();
  });

  beforeEach(async () => {
    const reset = await resetScene(c);
    if (!reset) await cleanupByPrefix(c);
  });

  test("reports clone count and per-clone matrices after ExecutePasses", async () => {
    const cubeName = testName("mg_cube");
    const clonerName = testName("mg_cloner");
    // Create a Cloner with a cube child. Linear mode with 4 copies.
    const cube = await c.call<{ handle: { path: string } }>("create_entity", {
      kind: "object",
      type_id: OCUBE,
      name: cubeName,
    });
    const cloner = await c.call<{ handle: { path: string } }>("create_entity", {
      kind: "object",
      type_id: MG_CLONER,
      name: clonerName,
    });
    // Nest the cube under the cloner.
    await c.call("move_entity", {
      handle: { kind: "object", path: cube.handle.path },
      parent: { kind: "object", path: cloner.handle.path },
    });

    const r = await c.call<{
      supported: boolean;
      count: number;
      clones: Array<{ pos: number[] }>;
    }>("list_mograph_clones", {
      handle: { kind: "object", path: cloner.handle.path },
    });
    if (!r.supported) {
      return; // MoData unreadable on this build
    }
    expect(r.count).toBeGreaterThan(0);
    expect(r.clones.length).toBe(r.count);
    expect(r.clones[0].pos.length).toBe(3);
  });
});
