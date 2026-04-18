import { z } from "zod";
import { defineTool, textResult } from "./define-tool.js";
import { handleSchema } from "./handle.js";

export const cloneEntityTool = defineTool({
  name: "clone_entity",
  group: "hierarchy",
  title: "Clone Entity",
  description:
    "Duplicate an object / tag / material / shader via GetClone. Objects default to dropping next to the source; pass `parent` to place the clone under a specific container. Tags and shaders require `parent` (the owner). Returns a handle to the new entity.",
  inputShape: {
    handle: handleSchema.describe("Source entity to clone."),
    name: z.string().optional().describe("Optional name for the clone."),
    parent: handleSchema
      .optional()
      .describe(
        "For objects: destination parent (defaults to source's sibling). For tags: required owner object. For shaders: required owner.",
      ),
  },
  async handler(args, client) {
    return textResult(await client.request("clone_entity", args, 15_000));
  },
});
