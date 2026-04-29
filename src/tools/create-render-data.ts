import { z } from "zod";
import { defineTool, textResult } from "./define-tool.js";

export const createRenderDataTool = defineTool({
  name: "create_render_data",
  group: "shot",
  title: "Create Render Data",
  description:
    "Create (or update-if-exists) a RenderData with resolution / renderer / fps / frame range in one call. Returns the render_data handle for subsequent create_take / set_params chaining.",
  inputShape: {
    name: z.string().describe("Render data name (used as handle)."),
    parent: z
      .string()
      .optional()
      .describe("Parent render_data name to nest under (default: top level)."),
    width: z.number().int().positive().optional().describe("Output width (pixels)."),
    height: z.number().int().positive().optional().describe("Output height (pixels)."),
    renderer: z
      .union([
        z.number().int(),
        z.enum(["standard", "physical", "redshift", "octane", "cycles", "viewport"]),
      ])
      .optional()
      .describe(
        'Renderer plugin id, or alias: "octane"/"standard"/"physical"/"redshift"/"cycles"/"viewport".',
      ),
    fps: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Frame rate (also disables Use Project Frame Rate)."),
    frame_start: z.number().int().optional().describe("Frame range start."),
    frame_end: z.number().int().optional().describe("Frame range end."),
    frame_sequence: z
      .enum(["manual", "current", "all", "preview", "custom"])
      .optional()
      .describe('Frame range mode (default "manual" when frame_start/end given).'),
    make_active: z.boolean().optional().describe("Make this the active render data."),
    update_if_exists: z
      .boolean()
      .optional()
      .describe("If a render data with this name already exists, update it instead of creating."),
    params: z
      .record(z.string(), z.union([z.boolean(), z.number(), z.string(), z.array(z.number())]))
      .optional()
      .describe("Extra {param_id: value} to apply (any RDATA_* id)."),
  },
  async handler(args, client) {
    return textResult(await client.request("create_render_data", args, 15_000));
  },
});
