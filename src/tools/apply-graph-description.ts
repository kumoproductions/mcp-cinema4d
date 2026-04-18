import { z } from "zod";
import { defineTool, textResult } from "./define-tool.js";
import { handleSchema } from "./handle.js";

export const applyGraphDescriptionTool = defineTool({
  name: "apply_graph_description",
  group: "node-materials",
  title: "Apply Node Graph Description",
  description:
    'Build or mutate a node material graph using maxon.GraphDescription\'s declarative dict syntax. Supports creating nodes (`$type`), assigning stable ids (`$id`), wiring connections via \'outputPort -> inputPort\' keys, and setting port values inline. Example: {"$type":"Output","Surface -> outColor":{"$type":"Standard Material","$id":"mat","Base/Color":[1,0,0]}}. See Maxon\'s Graph Descriptions Manual for the full spec. Creates the graph on demand by default.',
  inputShape: {
    handle: handleSchema
      .optional()
      .describe("Material handle. Required unless `scope:'document'`."),
    scope: z
      .literal("document")
      .optional()
      .describe("Target the active document's scene-nodes graph instead of a material."),
    description: z
      .record(z.string(), z.any())
      .describe("maxon.GraphDescription dict (nested; $type / $id / '->' keys)."),
    node_space: z
      .string()
      .optional()
      .describe(
        "Alias 'standard' | 'redshift' | 'scenenodes' or a maxon.Id. Default 'standard' for materials, 'scenenodes' for document scope.",
      ),
    create_graph: z.boolean().optional().describe("Create the graph if missing. Default true."),
  },
  async handler(args, client) {
    return textResult(await client.request("apply_graph_description", args, 30_000));
  },
});
