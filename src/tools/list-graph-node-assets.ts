import { z } from "zod";
import { defineTool, textResult } from "./define-tool.js";

export const listGraphNodeAssetsTool = defineTool({
  name: "list_graph_node_assets",
  group: "node-materials",
  title: "List Node Graph Asset Types",
  description:
    "Enumerate registered node-template assets for a node space. Returns the ids LLMs can pass to `apply_graph_description` as `$type` (e.g. 'Standard Material', 'Texture', 'Output'). `supported:false` comes back when the C4D build lacks the maxon framework. Pair with `list_graph_nodes` for the existing-graph side.",
  inputShape: {
    node_space: z
      .string()
      .optional()
      .describe("Alias 'standard' | 'redshift' or a fully-qualified maxon.Id. Default 'standard'."),
  },
  async handler(args, client) {
    return textResult(await client.request("list_graph_node_assets", args, 15_000));
  },
});
