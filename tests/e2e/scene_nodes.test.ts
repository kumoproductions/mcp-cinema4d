import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { MCPTestClient, probeBridge, resetScene } from "./harness.js";

const probe = await probeBridge("scene_nodes");
const ready = probe.ready;
const client: MCPTestClient | null = probe.client ?? null;

// Scene Nodes (neutron) needs the maxon framework. Detect once so tests skip
// cleanly with a readable reason on builds that lack it.
let neutronSupported = false;
// Valid $type values for the neutron space are node-template asset ids
// (net.maxon.node.*, not net.maxon.corenode:*). We pin two stable, widely
// available ones at setup so connection wiring can be exercised portably.
let composeId: string | null = null;
let decomposeId: string | null = null;
let anyNodeId: string | null = null;

if (ready && client) {
  try {
    const r = await client.call<{ supported: boolean }>("list_graph_nodes", {
      scope: "document",
      node_space: "scenenodes",
    });
    neutronSupported = r.supported !== false;
  } catch {
    neutronSupported = false;
  }

  if (neutronSupported) {
    try {
      const assets = await client.call<{
        supported: boolean;
        assets: Array<{ id: string }>;
      }>("list_graph_node_assets", { node_space: "scenenodes" });
      if (assets.supported) {
        const ids = new Set(assets.assets.map((a) => a.id));
        composeId = ids.has("net.maxon.node.access.composecolor64")
          ? "net.maxon.node.access.composecolor64"
          : null;
        decomposeId = ids.has("net.maxon.node.access.decomposecolor64")
          ? "net.maxon.node.access.decomposecolor64"
          : null;
        anyNodeId =
          composeId ?? assets.assets.find((a) => a.id.startsWith("net.maxon.node."))?.id ?? null;
      }
    } catch {
      /* leave ids null — individual tests skip */
    }
  }
}

describe.skipIf(!ready || !neutronSupported)("scene nodes (neutron)", () => {
  const c = client!;

  afterAll(async () => {
    await c.close();
  });

  beforeEach(async () => {
    await resetScene(c);
  });

  test("list_graph_node_assets returns neutron-addable ids only", async () => {
    const r = await c.call<{
      supported: boolean;
      node_space: string;
      assets: Array<{ id: string }>;
    }>("list_graph_node_assets", { node_space: "scenenodes" });
    expect(r.supported).toBe(true);
    expect(r.node_space).toMatch(/neutron\.nodespace/);
    // Material-space templates must not leak into the neutron catalogue.
    for (const a of r.assets) {
      expect(a.id.startsWith("com.redshift3d")).toBe(false);
      expect(a.id.startsWith("net.maxon.render.")).toBe(false);
    }
  });

  test.skipIf(anyNodeId === null)(
    "apply_graph_description creates a scene node via the low-level path",
    async () => {
      const r = await c.call<{ applied: boolean; touched_ids: string[] }>(
        "apply_graph_description",
        {
          scope: "document",
          node_space: "scenenodes",
          description: { $type: anyNodeId!, $id: "mcp_sn_single" },
        },
      );
      expect(r.applied).toBe(true);
      expect(r.touched_ids.length).toBe(1);

      const listed = await c.call<{ nodes: Array<{ asset_id?: string | null }> }>(
        "list_graph_nodes",
        {
          scope: "document",
          node_space: "scenenodes",
        },
      );
      expect(listed.nodes.some((n) => (n.asset_id ?? "").includes(anyNodeId!))).toBe(true);
    },
  );

  test.skipIf(composeId === null || decomposeId === null)(
    "apply_graph_description wires connections and sets port values",
    async () => {
      const r = await c.call<{ applied: boolean; touched_ids: string[] }>(
        "apply_graph_description",
        {
          scope: "document",
          node_space: "scenenodes",
          description: {
            $type: decomposeId!,
            $id: "dec",
            "colorin -> colorout": {
              $type: composeId!,
              $id: "comp",
              rin: 0.25,
              gin: 0.5,
              bin: 0.75,
            },
          },
        },
      );
      expect(r.applied).toBe(true);
      expect(r.touched_ids.length).toBe(2);

      const listed = await c.call<{ nodes: Array<{ asset_id?: string | null }> }>(
        "list_graph_nodes",
        {
          scope: "document",
          node_space: "scenenodes",
        },
      );
      const ids = listed.nodes.map((n) => n.asset_id ?? "");
      expect(ids.some((a) => a.includes(composeId!))).toBe(true);
      expect(ids.some((a) => a.includes(decomposeId!))).toBe(true);
    },
  );

  test("rejects the wrong corenode id with an actionable error", async () => {
    const msg = await c.callExpectError("apply_graph_description", {
      scope: "document",
      node_space: "scenenodes",
      description: { $type: "net.maxon.corenode:concat", $id: "bad" },
    });
    expect(msg).toMatch(/list_graph_node_assets|node-template asset id|not addable/i);
  });
});
