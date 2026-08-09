import { z } from "zod";
import { defineTool, textResult } from "./define-tool.js";

export const setMarkerTool = defineTool({
  name: "set_marker",
  group: "shot",
  title: "Edit Timeline Marker",
  description:
    "Rename, recolour, move, or resize an existing timeline marker. Identify the target by exactly one of `index` (from list_markers — always unambiguous), `frame`, or `name` (the latter two error if several markers match). Pass at least one update field. Returns the updated marker's info.",
  inputShape: {
    index: z
      .number()
      .int()
      .optional()
      .describe("Target by position in the marker chain (see list_markers)."),
    frame: z
      .number()
      .int()
      .optional()
      .describe("Target the marker at this frame (errors on ambiguity)."),
    name: z.string().optional().describe("Target by name (errors on ambiguity)."),
    new_name: z.string().optional().describe("New label for the marker."),
    color: z
      .tuple([z.number().min(0).max(1), z.number().min(0).max(1), z.number().min(0).max(1)])
      .optional()
      .describe("New colour as [r, g, b] floats in 0..1."),
    new_frame: z.number().int().optional().describe("Move the marker to this frame."),
    new_time_seconds: z
      .number()
      .optional()
      .describe("Move the marker to this time in seconds (mutually exclusive with new_frame)."),
    length_frames: z.number().int().optional().describe("New marker length in frames."),
  },
  async handler(args, client) {
    return textResult(await client.request("set_marker", args, 15_000));
  },
});
