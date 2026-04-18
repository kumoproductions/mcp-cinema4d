import { z } from "zod";
import { defineTool, textResult } from "./define-tool.js";
import { handleSchema } from "./handle.js";

export const assignToLayerTool = defineTool({
  name: "assign_to_layer",
  group: "layers",
  title: "Assign To Layer",
  description:
    "Place a target (object / tag / material) on a named layer. Pass `layer:null` to clear the assignment. The layer must exist — call `create_layer` first if needed.",
  inputShape: {
    target: handleSchema.describe("Entity to assign."),
    layer: z.string().nullable().describe("Layer name, or null to clear."),
  },
  async handler(args, client) {
    return textResult(await client.request("assign_to_layer", args, 10_000));
  },
});
