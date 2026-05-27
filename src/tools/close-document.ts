import { z } from "zod";
import { defineTool, textResult } from "./define-tool.js";

export const closeDocumentTool = defineTool({
  name: "close_document",
  group: "document-io",
  title: "Close Document",
  description:
    "Close an open document, identified by its list `index` (from `list_documents`) or `name`. Pass exactly one of the two. A document with unsaved changes is refused unless `force:true` — closing discards unsaved work without a prompt (unlike the GUI close). C4D always keeps at least one document, so closing the last one leaves a fresh empty document active.",
  inputShape: {
    index: z
      .number()
      .int()
      .optional()
      .describe("0-based position in the document list (see `list_documents`)."),
    name: z
      .string()
      .optional()
      .describe("Document name; errors if it matches zero or several open documents."),
    force: z
      .boolean()
      .optional()
      .describe("Close even with unsaved changes, discarding them. Default false."),
  },
  async handler(args, client) {
    return textResult(await client.request("close_document", args, 10_000));
  },
});
