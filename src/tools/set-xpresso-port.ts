import { z } from "zod";
import { defineTool, textResult } from "./define-tool.js";
import { handleSchema } from "./handle.js";

const portRefSchema = z.object({
  dir: z.enum(["in", "out"]).describe("Port direction."),
  index: z.number().int().nonnegative().optional(),
  main_id: z.number().int().optional(),
  sub_id: z.number().int().optional(),
  name: z.string().optional(),
});

const targetPortRefSchema = portRefSchema.extend({
  node_handle: handleSchema.describe("gv_node handle identifying the peer node."),
});

export const setXpressoPortTool = defineTool({
  name: "set_xpresso_port",
  group: "node-materials",
  title: "Edit Xpresso Port",
  description:
    "Low-level Xpresso port primitive — covers cases `apply_xpresso_graph` can't express. `action:'add'` adds a new input/output port via GvNode.AddPort(port_id). `connect` wires this node's `port` to `target` (on a peer node identified by `target.node_handle`); output-vs-input direction is auto-detected. `disconnect` removes incoming connections from `port`. `set_value` writes the port's default. `remove` deletes the port. Use `list_xpresso_nodes` first to discover node path ids and existing ports.",
  inputShape: {
    node: handleSchema.describe("gv_node handle for the operated-on GvNode."),
    action: z
      .enum(["add", "remove", "connect", "disconnect", "set_value"])
      .describe("Operation to perform."),
    port: portRefSchema
      .optional()
      .describe("Target port selector. Required for remove / connect / disconnect / set_value."),
    target: targetPortRefSchema
      .optional()
      .describe("Peer port selector (with its node_handle). Required for connect."),
    io: z.enum(["in", "out"]).optional().describe("Direction for `add`."),
    port_id: z
      .number()
      .int()
      .optional()
      .describe("Port main id passed to GvNode.AddPort (required for `add`)."),
    value: z
      .union([z.boolean(), z.number(), z.string(), z.tuple([z.number(), z.number(), z.number()])])
      .optional()
      .describe("New default value for `set_value`. [x,y,z] is coerced to c4d.Vector."),
  },
  async handler(args, client) {
    return textResult(await client.request("set_xpresso_port", args, 15_000));
  },
});
