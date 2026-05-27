import { z } from "zod";
import { defineTool, textResult } from "./define-tool.js";

export const setActiveDocumentTool = defineTool({
  name: "set_active_document",
  group: "document-io",
  title: "Set Active Document",
  description:
    "Switch focus to an already-open document, identified by its list `index` (from `list_documents`) or `name`. Pass exactly one of the two. `name` errors if it matches zero or several open documents — use `index` to disambiguate. This only switches between documents already open; use `open_document` to load a file from disk.",
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
  },
  async handler(args, client) {
    return textResult(await client.request("set_active_document", args, 10_000));
  },
});
