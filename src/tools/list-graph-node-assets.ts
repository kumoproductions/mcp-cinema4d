import { z } from "zod";
import { defineTool, textResult } from "./define-tool.js";

export const listGraphNodeAssetsTool = defineTool({
  name: "list_graph_node_assets",
  group: "node-materials",
  title: "List Node Graph Asset Types",
  description:
    "Enumerate registered node-template asset ids for a node space — the ids you pass to `apply_graph_description` as `$type`. For the scene-nodes (neutron) space, results are filtered to the templates actually addable there (e.g. 'net.maxon.node.invert', 'net.maxon.node.access.composecolor64'); note these differ from the net.maxon.corenode:* ids that `list_graph_nodes` reports for existing nodes. `supported:false` comes back when the C4D build lacks the maxon framework.",
  inputShape: {
    node_space: z
      .string()
      .optional()
      .describe(
        "Alias 'standard' | 'redshift' | 'scenenodes' (a.k.a. 'neutron') or a fully-qualified maxon.Id. Default 'standard'.",
      ),
  },
  async handler(args, client) {
    return textResult(await client.request("list_graph_node_assets", args, 15_000));
  },
});
