import { z } from "zod";
import { defineTool, textResult } from "./define-tool.js";
import { handleSchema } from "./handle.js";

export const setKeyframeTool = defineTool({
  name: "set_keyframe",
  group: "crud",
  title: "Set Keyframe",
  description:
    "Create or update a single keyframe on a resolved entity's parameter. Supports scalar (real/long/bool) and vector (x/y/z component) parameters; the bridge infers the dtype from the entity's description, or you can override it explicitly. Creates the CTrack automatically on first use.",
  inputShape: {
    handle: handleSchema.describe("Entity whose parameter gets the keyframe."),
    param_id: z
      .number()
      .int()
      .describe("Top-level description id (e.g. c4d.ID_BASEOBJECT_REL_ROTATION = 904)."),
    component: z
      .enum(["x", "y", "z"])
      .optional()
      .describe(
        'Sub-component for Vector params. For C4D rotation (HPB) use "x" for H, "y" for P, "z" for B.',
      ),
    frame: z.number().int().describe("Frame number."),
    value: z
      .union([z.number(), z.boolean()])
      .describe("Value at this frame (rotations in radians; bools coerce to 0/1)."),
    fps: z.number().int().positive().optional().describe("Time base override (default: doc fps)."),
    interp: z
      .enum(["linear", "spline", "step"])
      .optional()
      .describe('Key interpolation (default "spline").'),
    dtype: z
      .enum(["real", "long", "bool", "vector"])
      .optional()
      .describe("Override the dtype when description lookup fails (rare)."),
  },
  async handler(args, client) {
    return textResult(await client.request("set_keyframe", args, 15_000));
  },
});
