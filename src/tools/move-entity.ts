import { z } from "zod";
import { defineTool, textResult } from "./define-tool.js";
import { handleSchema } from "./handle.js";

export const moveEntityTool = defineTool({
  name: "move_entity",
  group: "hierarchy",
  title: "Move / Reparent / Reorder Object",
  description:
    "Reparent an object under a new parent, promote it to the document root, or reorder it relative to a sibling. Exactly one destination field must be provided (`parent`, `before`, `after`, or `to_root:true`). Returns the object's new canonical handle so follow-up edits remain stable.",
  inputShape: {
    handle: handleSchema.describe("Object to move."),
    parent: handleSchema.optional().describe("Insert as last child of this parent."),
    before: handleSchema.optional().describe("Insert immediately before this sibling."),
    after: handleSchema.optional().describe("Insert immediately after this sibling."),
    to_root: z.boolean().optional().describe("Promote to the document root (top-level insert)."),
  },
  async handler(args, client) {
    return textResult(await client.request("move_entity", args, 10_000));
  },
});
