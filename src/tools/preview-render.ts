import { z } from "zod";
import { defineTool, imageResult } from "./define-tool.js";

const VIEW_VALUES = ["current", "top", "bottom", "left", "right", "front", "back"] as const;

export const previewRenderTool = defineTool({
  name: "preview_render",
  group: "basics",
  title: "Preview Render (Viewport, Constant Lines)",
  description:
    "Quick agent-friendly verification render. Uses the Viewport renderer with the active editor view temporarily switched to Constant Shading (Lines) — sketch-style and fast. Independent of the active RenderData (built freestanding, never inserted) and restores BaseDraw / camera / time / take in finally. Returns a base64 PNG inline so the agent can directly view it. Use `view: top|bottom|left|right|front|back` for an auto-framed temp camera, or `camera` to render through a named scene camera. Pass `save_path` to also write the PNG to disk.",
  inputShape: {
    width: z
      .number()
      .int()
      .positive()
      .max(4096)
      .optional()
      .describe("Output width in pixels (default 1024, max 4096)."),
    height: z
      .number()
      .int()
      .positive()
      .max(4096)
      .optional()
      .describe("Output height in pixels (default 1024, max 4096)."),
    view: z
      .enum(VIEW_VALUES)
      .optional()
      .describe(
        "Preset view. 'current' (default) uses the active BaseDraw camera. The other presets place a temp camera looking at the scene bounds from that side; the temp camera is removed in finally.",
      ),
    camera: z
      .string()
      .optional()
      .describe("Optional scene camera object name. Mutually exclusive with a non-'current' view."),
    frame: z
      .number()
      .int()
      .optional()
      .describe("Optional frame number; defaults to the current document time."),
    take: z
      .string()
      .optional()
      .describe("Optional take name to switch to before rendering. Restored afterward."),
    save_path: z
      .string()
      .optional()
      .describe(
        "Optional absolute PNG path. When set, the rendered image is also written to disk (parent directory must already exist). The base64 PNG is still returned inline.",
      ),
  },
  async handler(args, client) {
    const params: Record<string, unknown> = {};
    if (args.width !== undefined) params.width = args.width;
    if (args.height !== undefined) params.height = args.height;
    if (args.view !== undefined) params.view = args.view;
    if (args.camera !== undefined) params.camera = args.camera;
    if (args.frame !== undefined) params.frame = args.frame;
    if (args.take !== undefined) params.take = args.take;
    if (args.save_path !== undefined) params.save_path = args.save_path;
    return imageResult(await client.request("preview_render", params, 60_000));
  },
});
