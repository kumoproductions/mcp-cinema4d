import { z } from "zod";
import { defineTool, textResult } from "./define-tool.js";
import { handleSchema } from "./handle.js";

export const moveEntityTool = defineTool({
  name: "move_entity",
  group: "hierarchy",
  title: "Move / Reparent / Reorder Node",
  description:
    "Reparent a node under a new parent, promote it to the top of its hierarchy, or reorder it relative to a sibling. Works on objects, takes, and render_data — siblings/parents must share the moved node's kind. Exactly one destination field must be provided (`parent`, `before`, `after`, or `to_root:true`). For takes, `to_root:true` reparents under Main; the Main take itself cannot be moved. Returns the node's new canonical handle so follow-up edits remain stable.",
  inputShape: {
    handle: handleSchema.describe("Node to move (object / take / render_data)."),
    parent: handleSchema.optional().describe("Insert as last child of this parent."),
    before: handleSchema.optional().describe("Insert immediately before this sibling."),
    after: handleSchema.optional().describe("Insert immediately after this sibling."),
    to_root: z
      .boolean()
      .optional()
      .describe(
        "Promote to the top of the hierarchy (objects → doc root, takes → under Main, render_data → top level).",
      ),
  },
  async handler(args, client) {
    return textResult(await client.request("move_entity", args, 10_000));
  },
});
