import { defineTool, textResult } from "./define-tool.js";

export const listDocumentsTool = defineTool({
  name: "list_documents",
  group: "document-io",
  title: "List Documents",
  description:
    "Enumerate the documents currently open in Cinema 4D. Each entry has its list `index` (the handle accepted by `set_active_document`), name, path and whether it is the active document. `get_document_state` only reports the active document; this is how you discover the others before switching.",
  inputShape: {},
  async handler(_args, client) {
    return textResult(await client.request("list_documents", {}, 5_000));
  },
});
