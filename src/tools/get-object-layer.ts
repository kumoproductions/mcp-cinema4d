import { defineTool, textResult } from "./define-tool.js";
import { handleSchema } from "./handle.js";

export const getObjectLayerTool = defineTool({
  name: "get_object_layer",
  group: "layers",
  title: "Get Object's Layer",
  description:
    "Return the layer currently assigned to a target entity (object / tag / material), or null if unassigned.",
  inputShape: {
    target: handleSchema.describe("Entity to query."),
  },
  async handler(args, client) {
    return textResult(await client.request("get_object_layer", args, 10_000));
  },
});
