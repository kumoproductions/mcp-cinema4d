import { afterAll, describe, expect, test } from "vitest";
import { MCPTestClient, probeBridge } from "./harness.js";

const probe = await probeBridge("graph_assets");
const ready = probe.ready;
const client: MCPTestClient | null = probe.client ?? null;

describe.skipIf(!ready)("list_graph_node_assets", () => {
  const c = client!;

  afterAll(async () => {
    await c.close();
  });

  test("returns a supported flag and shape-correct payload for standard space", async () => {
    const r = await c.call<{
      supported: boolean;
      node_space: string;
      assets: Array<{ id: string; name?: string; category?: string }>;
    }>("list_graph_node_assets", { node_space: "standard" });
    expect(typeof r.supported).toBe("boolean");
    expect(Array.isArray(r.assets)).toBe(true);
    if (!r.supported) {
      // Maxon asset repository not reachable on this build; tool still
      // honoured the shape contract which is what we're verifying.
      return;
    }
    expect(r.node_space).toMatch(/maxon\.nodespace\.standard/);
    // When the repository IS reachable, entries follow the documented
    // shape. We don't assert on count — some builds ship an empty
    // NodeTemplate category and that's not a bug in our bridge.
    for (const entry of r.assets) {
      expect(typeof entry.id).toBe("string");
      expect(entry.id.length).toBeGreaterThan(0);
    }
  });
});
