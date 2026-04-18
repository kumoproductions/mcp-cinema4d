import { z } from "zod";
import { defineTool, textResult } from "./define-tool.js";
import { handleSchema } from "./handle.js";

export const setGraphPortTool = defineTool({
  name: "set_graph_port",
  group: "node-materials",
  title: "Set Node Graph Port Value",
  description:
    "Update a single port on a node addressable by its stable $id within a node material graph. Thin convenience over apply_graph_description: internally builds a {$query:{$id:node_id}, port: value} payload. Lists of 3 numbers are coerced to maxon.Vector for vector-typed ports.",
  inputShape: {
    handle: handleSchema
      .optional()
      .describe("Material handle. Required unless `scope:'document'`."),
    scope: z
      .literal("document")
      .optional()
      .describe("Target the scene-nodes graph on the active document."),
    node_id: z.string().describe("The $id assigned to the target node."),
    port: z.string().describe("Port path, e.g. 'Base/Metalness' or 'Image/Custom Gamma'."),
    value: z
      .union([z.boolean(), z.number(), z.string(), z.tuple([z.number(), z.number(), z.number()])])
      .describe("New port value. [x,y,z] is passed as maxon.Vector."),
    node_space: z
      .string()
      .optional()
      .describe("Alias 'standard' | 'redshift' | 'scenenodes' or maxon.Id. Default 'standard'."),
  },
  async handler(args, client) {
    return textResult(await client.request("set_graph_port", args, 15_000));
  },
});
