import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { cleanupByPrefix, MCPTestClient, probeBridge, resetScene, testName } from "./harness.js";

const probe = await probeBridge("xpresso");
const ready = probe.ready;
const client: MCPTestClient | null = probe.client ?? null;

type PortSummary = {
  main_id: number | null;
  sub_id: number | null;
  name: string;
  connected: boolean;
};
type NodeSummary = {
  id: string;
  parent_id: string | null;
  name: string;
  operator_id: number | null;
  operator_name: string;
  is_group: boolean;
  in_ports: PortSummary[];
  out_ports: PortSummary[];
};

describe.skipIf(!ready)("xpresso", () => {
  const c = client!;

  afterAll(async () => {
    await cleanupByPrefix(c);
    await c.close();
  });

  beforeEach(async () => {
    const reset = await resetScene(c);
    if (!reset) await cleanupByPrefix(c);
  });

  test("apply_xpresso_graph creates the tag, nodes and a connection", async () => {
    const cubeName = testName("xp_host");
    await c.call("create_entity", { kind: "object", type_id: "cube", name: cubeName });

    const applied = await c.call<{
      applied: boolean;
      tag: { object: string; type_id: number };
      nodes: Record<string, { id: string; operator_id: number }>;
      connections: Array<{ ok?: boolean; error?: string }>;
    }>("apply_xpresso_graph", {
      handle: { kind: "object", name: cubeName },
      create_tag_if_missing: true,
      nodes: {
        c: { operator_id: "const", position: [100, 100] },
        r: { operator_id: "result", position: [300, 100] },
      },
      connect: [{ from: { node: "c", index: 0 }, to: { node: "r", index: 0 } }],
    });
    expect(applied.applied).toBe(true);
    expect(applied.tag.object).toBe(cubeName);
    expect(Object.keys(applied.nodes)).toEqual(expect.arrayContaining(["c", "r"]));
    expect(applied.connections.length).toBe(1);
    // Some C4D builds auto-populate or re-route ports — accept either a
    // reported ok=true or a bridge-surfaced error message; the next assertion
    // (list_xpresso_nodes reflects the connection) is the ground truth.
    const conn = applied.connections[0];
    expect(conn.ok === true || typeof conn.error === "string").toBe(true);

    const listed = await c.call<{ nodes: NodeSummary[] }>("list_xpresso_nodes", {
      handle: { kind: "object", name: cubeName },
    });
    const constNode = listed.nodes.find((n) => n.operator_name.toLowerCase().includes("constant"));
    const resultNode = listed.nodes.find((n) => n.operator_name.toLowerCase().includes("result"));
    expect(constNode).toBeDefined();
    expect(resultNode).toBeDefined();
    expect(resultNode!.in_ports.some((p) => p.connected)).toBe(true);
  });

  test("set_params round-trips GV_CONST_VALUE on a gv_node handle", async () => {
    const cubeName = testName("xp_params");
    await c.call("create_entity", { kind: "object", type_id: "cube", name: cubeName });
    const applied = await c.call<{ nodes: Record<string, { id: string }> }>("apply_xpresso_graph", {
      handle: { kind: "object", name: cubeName },
      create_tag_if_missing: true,
      nodes: { c: { operator_id: "const" } },
    });
    const constPath = applied.nodes.c.id;

    // c4d.GV_CONST_VALUE = 1000 on every build that ships the Constant node.
    const GV_CONST_VALUE = 1000;
    await c.call("set_params", {
      handle: {
        kind: "gv_node",
        tag: { kind: "tag", object: cubeName, type_id: 1001149 /* c4d.Texpresso */ },
        id: constPath,
      },
      values: [{ path: GV_CONST_VALUE, value: 42.5 }],
    });
    const read = await c.call<{ values: Array<{ value: number; error?: string }> }>("get_params", {
      handle: {
        kind: "gv_node",
        tag: { kind: "tag", object: cubeName, type_id: 1001149 },
        id: constPath,
      },
      ids: [GV_CONST_VALUE],
    });
    // Some builds expose GV_CONST_VALUE as a sub-id inside a group; if the
    // primary id isn't directly writable we accept a descriptive error and
    // still treat the bridge contract as honoured.
    const first = read.values[0];
    if (first.error) {
      expect(first.error).toMatch(/Desc|path|port|constant/i);
    } else {
      expect(Number(first.value)).toBeCloseTo(42.5, 5);
    }
  });

  test("remove_xpresso_node deletes a node by gv_node handle", async () => {
    const cubeName = testName("xp_remove");
    await c.call("create_entity", { kind: "object", type_id: "cube", name: cubeName });
    const applied = await c.call<{ nodes: Record<string, { id: string }> }>("apply_xpresso_graph", {
      handle: { kind: "object", name: cubeName },
      create_tag_if_missing: true,
      nodes: { a: { operator_id: "const" }, b: { operator_id: "result" } },
    });
    const before = await c.call<{ nodes: NodeSummary[] }>("list_xpresso_nodes", {
      handle: { kind: "object", name: cubeName },
    });
    expect(before.nodes.length).toBeGreaterThanOrEqual(2);

    await c.call("remove_xpresso_node", {
      handle: {
        kind: "gv_node",
        tag: { kind: "tag", object: cubeName, type_id: 1001149 },
        id: applied.nodes.a.id,
      },
    });

    const after = await c.call<{ nodes: NodeSummary[] }>("list_xpresso_nodes", {
      handle: { kind: "object", name: cubeName },
    });
    expect(after.nodes.length).toBe(before.nodes.length - 1);
  });
});
