import { z } from "zod";
import { defineTool, textResult } from "./define-tool.js";
import { handleSchema } from "./handle.js";

export const setSelectionTool = defineTool({
  name: "set_selection",
  group: "selection",
  title: "Set Active Selection",
  description:
    "Replace or extend the active document's selection. Pass `objects` (first becomes the active object), `tag`, or `material`. With `mode:'add'` the listed objects are added to the existing selection; with `mode:'replace'` (default) the prior selection is cleared first. `clear:true` deselects everything and ignores other fields.",
  inputShape: {
    objects: z
      .array(handleSchema)
      .optional()
      .describe("Object handles to select. The first becomes the active object."),
    tag: handleSchema.optional().describe("Tag handle to set as active."),
    material: handleSchema.optional().describe("Material handle to set as active."),
    mode: z
      .enum(["replace", "add"])
      .optional()
      .describe("Applies to `objects`. Default 'replace'."),
    clear: z.boolean().optional().describe("If true, deselect everything and ignore other fields."),
  },
  async handler(args, client) {
    return textResult(await client.request("set_selection", args, 10_000));
  },
});
