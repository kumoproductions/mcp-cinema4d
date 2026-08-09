import { z } from "zod";
import { defineTool, textResult } from "./define-tool.js";

export const removeMarkerTool = defineTool({
  name: "remove_marker",
  group: "shot",
  title: "Remove Timeline Marker",
  description:
    "Delete one timeline marker, or all of them. Pass `all:true` to clear every marker, or identify a single target by exactly one of `index` (from list_markers), `frame`, or `name` (the latter two error if several markers match). Returns `{removed: N}`.",
  inputShape: {
    all: z.boolean().optional().describe("Remove every marker (ignores the selectors below)."),
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
  },
  async handler(args, client) {
    return textResult(await client.request("remove_marker", args, 15_000));
  },
});
