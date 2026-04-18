import { z } from "zod";
import { defineTool, textResult } from "./define-tool.js";
import { handleSchema } from "./handle.js";

export const deleteTrackTool = defineTool({
  name: "delete_track",
  group: "animation",
  title: "Delete Animation Track",
  description:
    "Remove an entire CTrack (identified by `param_id` + optional `component`) from the target. Returns `{removed: bool}`.",
  inputShape: {
    handle: handleSchema.describe("Animated target."),
    param_id: z.number().int().describe("Top-level description id."),
    component: z
      .enum(["x", "y", "z"])
      .nullable()
      .optional()
      .describe("Vector sub-component. null / omitted for scalar tracks."),
  },
  async handler(args, client) {
    return textResult(await client.request("delete_track", args, 10_000));
  },
});
