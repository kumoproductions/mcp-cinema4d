import { z } from "zod";
import { defineTool, textResult } from "./define-tool.js";

export const renderTool = defineTool({
  name: "render",
  group: "basics",
  title: "Render Active Document",
  description:
    "Render the active Cinema 4D document at its currently-active render data settings. To change resolution / renderer / frame range / etc., adjust the active RenderData first via `create_render_data` (with `update_if_exists:true` on the active RD) or `set_params`. May take up to 60 seconds.",
  inputShape: {
    output_path: z
      .string()
      .optional()
      .describe("Optional absolute path to write the rendered image. Defaults to a temp file."),
  },
  async handler(args, client) {
    const params: Record<string, unknown> = {};
    if (args.output_path !== undefined) params.output_path = args.output_path;
    return textResult(await client.request("render", params, 180_000));
  },
});
