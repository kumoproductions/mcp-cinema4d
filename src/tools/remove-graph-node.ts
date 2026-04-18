import { z } from "zod";
import { defineTool, textResult } from "./define-tool.js";
import { handleSchema } from "./handle.js";

export const removeGraphNodeTool = defineTool({
  name: "remove_graph_node",
  group: "node-materials",
  title: "Remove Node Graph Node",
  description:
    "Delete a node by id from a node-material graph. The id must match the node's stable maxon.Id (as reported by list_graph_nodes or assigned via $id in apply_graph_description).",
  inputShape: {
    handle: handleSchema
      .optional()
      .describe("Material handle. Required unless `scope:'document'`."),
    scope: z
      .literal("document")
      .optional()
      .describe("Target the scene-nodes graph on the active document."),
    node_id: z.string().describe("The id of the node to remove."),
    node_space: z
      .string()
      .optional()
      .describe("Alias 'standard' | 'redshift' | 'scenenodes' or maxon.Id. Default 'standard'."),
  },
  async handler(args, client) {
    return textResult(await client.request("remove_graph_node", args, 15_000));
  },
});
