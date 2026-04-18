import { z } from "zod";
import { defineTool, textResult } from "./define-tool.js";

const flagShape = {
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
};

export const createLayerTool = defineTool({
  name: "create_layer",
  group: "layers",
  title: "Create Layer",
  description:
    "Create a LayerObject at the document's layer root. With `update_if_exists:true` the existing layer with the same name is updated in place (idempotent). Pass `color:[r,g,b]` (0..1) and/or `flags:{solo,view,render,manager,locked,...}` to configure it.",
  inputShape: {
    name: z.string().describe("Layer display name (also used for lookup)."),
    color: z.tuple([z.number(), z.number(), z.number()]).optional().describe("[r,g,b] in 0..1."),
    flags: z.object(flagShape).optional().describe("Initial flag values."),
    update_if_exists: z.boolean().optional().describe("Idempotent update. Default false."),
  },
  async handler(args, client) {
    return textResult(await client.request("create_layer", args, 10_000));
  },
});
