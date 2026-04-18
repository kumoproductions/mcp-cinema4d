import { defineTool, textResult } from "./define-tool.js";
import { handleSchema } from "./handle.js";

export const getGraphInfoTool = defineTool({
  name: "get_graph_info",
  group: "node-materials",
  title: "Get Node Material Graph Info",
  description:
    "Report which node spaces a material exposes a graph in, which one is currently active, and the alias table the bridge understands. Use this before `apply_graph_description` to confirm the right `node_space` is addressable on this build / material.",
  inputShape: {
    handle: handleSchema.describe("Material handle."),
  },
  async handler(args, client) {
    return textResult(await client.request("get_graph_info", args, 5_000));
  },
});
