import { z } from "zod";
import { defineTool, textResult } from "./define-tool.js";
import { handleSchema } from "./handle.js";

export const getKeyframesTool = defineTool({
  name: "get_keyframes",
  group: "animation",
  title: "Get Keyframes",
  description:
    "Read the keys on a specific animation track. Combine with list_tracks to discover which (param_id, component) pairs are animated. Returns `[{frame, value, interp}]`. Optional start_frame / end_frame clip the range inclusively.",
  inputShape: {
    handle: handleSchema.describe("Animated entity."),
    param_id: z.number().int().describe("Top-level description id of the parameter."),
    component: z
      .enum(["x", "y", "z"])
      .nullable()
      .optional()
      .describe("Sub-component for vector parameters. Omit / null for scalar tracks."),
    start_frame: z.number().int().optional().describe("Inclusive lower frame bound."),
    end_frame: z.number().int().optional().describe("Inclusive upper frame bound."),
    fps: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Override for BaseTime → frame conversion."),
  },
  async handler(args, client) {
    return textResult(await client.request("get_keyframes", args, 10_000));
  },
});
