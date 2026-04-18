import { z } from "zod";
import { defineTool, textResult } from "./define-tool.js";

export const createTakeTool = defineTool({
  name: "create_take",
  group: "shot",
  title: "Create / Update Take",
  description:
    "Create or update a Take (AddTake + SetCamera + SetRenderData + SetChecked) in one call. New takes are checked by default so they participate in batch renders; pass `checked:false` to override. Returns the take handle — ideal for building per-shot take stacks programmatically.",
  inputShape: {
    name: z.string().describe("Take name (used as handle)."),
    parent: z.string().optional().describe("Parent take name (default: Main)."),
    camera: z.string().optional().describe("Object name to link as the take's camera override."),
    render_data: z
      .string()
      .optional()
      .describe("Render data name to link as the take's render settings override."),
    checked: z
      .boolean()
      .optional()
      .describe("Checked state for batch rendering (default true on create)."),
    make_active: z.boolean().optional().describe("Make this take the current take."),
    update_if_exists: z
      .boolean()
      .optional()
      .describe("If a take with this name already exists, update it instead of creating."),
    clear_camera: z.boolean().optional().describe("Explicitly clear the camera override."),
    clear_render_data: z
      .boolean()
      .optional()
      .describe("Explicitly clear the render data override."),
  },
  async handler(args, client) {
    return textResult(await client.request("create_take", args, 15_000));
  },
});
