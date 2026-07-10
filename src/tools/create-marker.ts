import { z } from "zod";
import { defineTool, textResult } from "./define-tool.js";

export const createMarkerTool = defineTool({
  name: "create_marker",
  group: "shot",
  title: "Create Timeline Marker",
  description:
    "Create a named timeline marker at a frame (or time in seconds), with optional colour and length, in one call (c4d.documents.AddMarker). Replaces the old workaround of seeking the playhead and firing the 'Create Marker at Current Frame' command, which could only drop unnamed markers. Returns the marker's info including its `index` handle for set_marker / remove_marker.",
  inputShape: {
    frame: z
      .number()
      .int()
      .optional()
      .describe("Frame position (mutually exclusive with time_seconds)."),
    time_seconds: z.number().optional().describe("Position in seconds (alternative to frame)."),
    name: z.string().optional().describe("Marker label (default empty)."),
    color: z
      .tuple([z.number(), z.number(), z.number()])
      .optional()
      .describe("Marker colour as [r, g, b] floats in 0..1."),
    length_frames: z
      .number()
      .int()
      .optional()
      .describe("Marker length in frames (default 0 — a point marker)."),
  },
  async handler(args, client) {
    return textResult(await client.request("create_marker", args, 15_000));
  },
});
