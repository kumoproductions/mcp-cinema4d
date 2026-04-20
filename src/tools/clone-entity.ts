import { z } from "zod";
import { defineTool, textResult } from "./define-tool.js";
import { handleSchema } from "./handle.js";

export const cloneEntityTool = defineTool({
  name: "clone_entity",
  group: "hierarchy",
  title: "Clone Entity",
  description:
    "Duplicate an entity. Supports object / tag / material / shader (via GetClone + parent insert), render_data (doc.InsertRenderData — copies VideoPosts too), video_post (rd.InsertVideoPost), and take (TakeData.AddTake, copying existing overrides). Objects default to dropping next to the source; pass `parent` to place the clone elsewhere. Returns a handle to the new entity.",
  inputShape: {
    handle: handleSchema.describe("Source entity to clone."),
    name: z.string().optional().describe("Optional name for the clone."),
    parent: handleSchema
      .optional()
      .describe(
        "For objects: destination parent (defaults to source's sibling). For tags: required owner object. For shaders: required owner. For video_post: target render_data (defaults to source's host). For take: parent take as handle (defaults to source's parent).",
      ),
  },
  async handler(args, client) {
    return textResult(await client.request("clone_entity", args, 15_000));
  },
});
