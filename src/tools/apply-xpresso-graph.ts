import { z } from "zod";
import { defineTool, textResult } from "./define-tool.js";
import { handleSchema } from "./handle.js";

const portRefSchema = z
  .object({
    node: z
      .string()
      .describe(
        "Caller-chosen node id from the `nodes` map, or an existing node addressed by dotted-index path (prefix with 'path:' to force, e.g. 'path:0.2').",
      ),
    dir: z
      .enum(["in", "out"])
      .optional()
      .describe("Port direction. Defaults to 'out' for `from`, 'in' for `to`."),
    index: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .describe("0-based index among the node's ports in that direction."),
    main_id: z
      .number()
      .int()
      .optional()
      .describe(
        "Port main id (preferred over index for operator-parameter ports like ID_BASEOBJECT_GLOBAL_POSITION).",
      ),
    sub_id: z.number().int().optional().describe("Sub id when main_id alone is ambiguous."),
    name: z.string().optional().describe("Port display name (fragile; prefer index / main_id)."),
  })
  .describe(
    "Endpoint selector. Priority: index > main_id (+ optional sub_id) > name. The referenced node must belong to the Xpresso tag being modified.",
  );

export const applyXpressoGraphTool = defineTool({
  name: "apply_xpresso_graph",
  group: "node-materials",
  title: "Apply Xpresso Graph Description",
  description:
    "Declarative builder for an Xpresso (classic GvNodeMaster) graph — mirror of `apply_graph_description` but for Xpresso rather than Maxon node materials. Creates nodes (CreateNode) and wires connections (GvPort.Connect) in one call. Accepts an operator_id as an int (e.g. c4d.ID_OPERATOR_CONST=1001150) or short alias ('object'|'const'|'result'|'math'|'range_mapper'|'condition'|'compare'|'memory'|'iterate'|'bool'|'freeze'|'formula'|'realtovect'|'vecttoreal'|'matrix2vect'|'vect2matrix'|'link'|'spy'|'python'). Optionally creates the Texpresso tag when given an object handle and `create_tag_if_missing:true`. Example: build a `Object.Global Position -> Result` graph in three calls (create Cube → apply_xpresso_graph → EventAdd).",
  inputShape: {
    handle: handleSchema.describe(
      "Xpresso tag handle (Texpresso) or an object handle (pass create_tag_if_missing:true to auto-add a tag).",
    ),
    create_tag_if_missing: z
      .boolean()
      .optional()
      .describe("When handle is an object and no Texpresso tag exists, create one. Default true."),
    nodes: z
      .record(
        z.string(),
        z.object({
          operator_id: z
            .union([z.number().int(), z.string()])
            .describe("GvNode operator id (ID_OPERATOR_* int) or a short alias."),
          name: z.string().optional().describe("Node display name."),
          parent: z
            .string()
            .optional()
            .describe(
              "Parent group: omit / 'root' for the master XGroup, another caller id from this call, or an existing path id like '0'.",
            ),
          position: z
            .tuple([z.number(), z.number()])
            .optional()
            .describe("Position [x, y] in the graph view. Default [-1, -1] (auto)."),
          params: z
            .record(z.string(), z.union([z.boolean(), z.number(), z.string(), z.array(z.number())]))
            .optional()
            .describe(
              "{operator_container_id: value} — e.g. {'1000': 10.5} to write GV_CONST_VALUE. Lists of 3 numbers become c4d.Vector.",
            ),
          references: z
            .record(z.string(), z.union([z.string(), handleSchema]))
            .optional()
            .describe(
              "{param_id: object_ref} to set BaseLink params (e.g. an XPresso Object node's GV_OBJECT_OBJECT_ID=1001). Value can be an object name, a '/A/B' path string, or a full handle dict.",
            ),
          in_ports: z
            .array(z.object({ id: z.number().int(), name: z.string().optional() }))
            .optional()
            .describe("Extra input ports to add via GvNode.AddPort (main_id)."),
          out_ports: z
            .array(z.object({ id: z.number().int(), name: z.string().optional() }))
            .optional()
            .describe("Extra output ports to add via GvNode.AddPort (main_id)."),
        }),
      )
      .describe("Node specs keyed by caller-chosen stable id (used in `connect`)."),
    connect: z
      .array(z.object({ from: portRefSchema, to: portRefSchema }))
      .optional()
      .describe(
        "Connection list. `from` defaults to dir='out' and `to` defaults to dir='in'. Internally always calls outputPort.Connect(inputPort).",
      ),
  },
  async handler(args, client) {
    return textResult(await client.request("apply_xpresso_graph", args, 30_000));
  },
});
