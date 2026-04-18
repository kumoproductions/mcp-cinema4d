import { z } from "zod";
import { defineTool, textResult } from "./define-tool.js";
import { handleSchema } from "./handle.js";

export const listGraphNodesTool = defineTool({
  name: "list_graph_nodes",
  group: "node-materials",
  title: "List Node Material Graph Nodes",
  description:
    "Walk a node graph and return a flat list of nodes. Target either a node-based material (via `handle`) or the active document's scene-nodes graph (via `scope:'document'`). `supported:false` comes back when the maxon framework is unavailable or no graph exists in the requested space.",
  inputShape: {
    handle: handleSchema
      .optional()
      .describe("Material handle. Required unless `scope:'document'`."),
    scope: z
      .literal("document")
      .optional()
      .describe("Set to 'document' to target the scene-nodes (neutron) graph."),
    node_space: z
      .string()
      .optional()
      .describe(
        "Alias 'standard' | 'redshift' | 'scenenodes' / 'neutron' or a fully-qualified maxon.Id. Default 'standard' (materials) or 'scenenodes' (document).",
      ),
  },
  async handler(args, client) {
    return textResult(await client.request("list_graph_nodes", args, 15_000));
  },
});
