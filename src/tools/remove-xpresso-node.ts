import { defineTool, textResult } from "./define-tool.js";
import { handleSchema } from "./handle.js";

export const removeXpressoNodeTool = defineTool({
  name: "remove_xpresso_node",
  group: "node-materials",
  title: "Remove Xpresso Graph Node",
  description:
    "Delete a GvNode from an Xpresso graph. The handle must be a gv_node handle pointing at the target (use `list_xpresso_nodes` to discover its path id). All incoming / outgoing connections on the node are severed automatically.",
  inputShape: {
    handle: handleSchema.describe("gv_node handle for the node to remove."),
  },
  async handler(args, client) {
    return textResult(await client.request("remove_xpresso_node", args, 15_000));
  },
});
