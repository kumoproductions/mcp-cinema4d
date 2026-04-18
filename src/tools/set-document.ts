import { z } from "zod";
import { defineTool, textResult } from "./define-tool.js";

export const setDocumentTool = defineTool({
  name: "set_document",
  group: "shot",
  title: "Set Document Settings",
  description:
    "Update document-level settings: fps, frame range, current frame, active camera. FPS and frame range are also mirrored onto the active render data.",
  inputShape: {
    fps: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Document FPS (also mirrored to active render data)."),
    frame_start: z.number().int().optional().describe("Document min time / loop-min in frames."),
    frame_end: z.number().int().optional().describe("Document max time / loop-max in frames."),
    current_frame: z.number().int().optional().describe("Move playhead to this frame."),
    active_camera: z
      .string()
      .optional()
      .describe("Name of the camera object to set as scene camera."),
  },
  async handler(args, client) {
    return textResult(await client.request("set_document", args, 10_000));
  },
});
