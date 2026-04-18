import { z } from "zod";
import { defineTool, textResult } from "./define-tool.js";

export const setLayerFlagsTool = defineTool({
  name: "set_layer_flags",
  group: "layers",
  title: "Set Layer Flags",
  description:
    "Toggle a layer's visibility / render / lock flags in one call. Only fields explicitly passed are modified; omitted flags keep their current value. `flags` returned in the response reflects the post-update state.",
  inputShape: {
    layer: z.string().describe("Layer name (required)."),
    solo: z.boolean().optional(),
    view: z.boolean().optional(),
    render: z.boolean().optional(),
    manager: z.boolean().optional(),
    locked: z.boolean().optional(),
    generators: z.boolean().optional(),
    deformers: z.boolean().optional(),
    expressions: z.boolean().optional(),
    animation: z.boolean().optional(),
    xref: z.boolean().optional(),
    color: z
      .tuple([z.number(), z.number(), z.number()])
      .optional()
      .describe("Optional color update as [r,g,b] in 0..1."),
  },
  async handler(args, client) {
    return textResult(await client.request("set_layer_flags", args, 10_000));
  },
});
