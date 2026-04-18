import { z } from "zod";
import { defineTool, textResult } from "./define-tool.js";

export const newDocumentTool = defineTool({
  name: "new_document",
  group: "document-io",
  title: "New Document",
  description:
    "Insert a fresh empty BaseDocument into C4D's document list and (by default) switch focus to it. Useful for starting a clean scene without overwriting the current one.",
  inputShape: {
    name: z.string().optional().describe("Optional display name for the new document."),
    make_active: z
      .boolean()
      .optional()
      .describe("Switch the active document to the new one. Default true."),
  },
  async handler(args, client) {
    return textResult(await client.request("new_document", args, 10_000));
  },
});
