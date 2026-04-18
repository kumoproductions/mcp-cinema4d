import { z } from "zod";
import { defineTool, textResult } from "./define-tool.js";
import { handleSchema } from "./handle.js";

export const deleteKeyframeTool = defineTool({
  name: "delete_keyframe",
  group: "animation",
  title: "Delete Keyframe",
  description:
    "Remove keys from a CTrack. Pass `frame` for a single-frame delete, or `start_frame` / `end_frame` (inclusive) for a range. Returns `{removed, track}`. Symmetric with `set_keyframe`.",
  inputShape: {
    handle: handleSchema.describe("Animated target."),
    param_id: z.number().int().describe("Top-level description id."),
    component: z
      .enum(["x", "y", "z"])
      .nullable()
      .optional()
      .describe("Vector sub-component. null / omitted for scalar tracks."),
    frame: z.number().int().optional().describe("Single frame to remove."),
    start_frame: z.number().int().optional().describe("Inclusive lower bound."),
    end_frame: z.number().int().optional().describe("Inclusive upper bound."),
    fps: z.number().int().positive().optional().describe("Override for BaseTime conversion."),
  },
  async handler(args, client) {
    return textResult(await client.request("delete_keyframe", args, 10_000));
  },
});
