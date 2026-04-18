import { z } from "zod";
import { defineTool, textResult } from "./define-tool.js";
import { handleSchema } from "./handle.js";

export const sampleTransformTool = defineTool({
  name: "sample_transform",
  group: "shot",
  title: "Sample Object Transform at Frames",
  description:
    "Evaluate the scene at each requested frame and return the object's transform. Useful to verify alembic / constraint / xpresso-driven animation without writing a bespoke exec_python sampler.",
  inputShape: {
    handle: handleSchema.describe("Target object handle (must resolve to a BaseObject)."),
    frames: z
      .array(z.number().int())
      .min(1)
      .max(500)
      .describe(
        "Frames to sample (1..500). The scene is evaluated at each frame via ExecutePasses.",
      ),
    fps: z.number().int().positive().optional().describe("Time base override (default: doc fps)."),
    space: z.enum(["global", "local"]).optional().describe('Transform space (default "global").'),
    format: z
      .enum(["off_rot", "matrix"])
      .optional()
      .describe(
        'Output format: "off_rot" returns pos+rot(HPB radians); "matrix" returns 4x3 rows.',
      ),
    restore_time: z
      .boolean()
      .optional()
      .describe("Restore the original playhead after sampling (default true)."),
  },
  async handler(args, client) {
    return textResult(await client.request("sample_transform", args, 60_000));
  },
});
