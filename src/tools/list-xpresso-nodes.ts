import { defineTool, textResult } from "./define-tool.js";
import { handleSchema } from "./handle.js";

export const listXpressoNodesTool = defineTool({
  name: "list_xpresso_nodes",
  group: "node-materials",
  title: "List Xpresso Graph Nodes",
  description:
    "Walk an Xpresso (Texpresso / GvNodeMaster) tag and return a flat list of its GvNodes. Each entry carries a stable dotted-index path id ('0.2' = root's first child, its third child) plus port summaries. Use the id to address nodes from `apply_xpresso_graph`, `set_xpresso_port`, `remove_xpresso_node`, or any handle-taking tool via `{kind:'gv_node', tag, id}`. Accepts either a tag handle (Texpresso) or an object handle (uses that object's first Texpresso tag).",
  inputShape: {
    handle: handleSchema.describe("Xpresso tag handle or host object handle."),
  },
  async handler(args, client) {
    return textResult(await client.request("list_xpresso_nodes", args, 15_000));
  },
});
