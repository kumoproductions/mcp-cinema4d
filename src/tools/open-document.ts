import { z } from "zod";
import { defineTool, textResult } from "./define-tool.js";

export const openDocumentTool = defineTool({
  name: "open_document",
  group: "document-io",
  title: "Open Document",
  description:
    "Load a Cinema 4D scene file as a new document. Unlike `import_scene` (which merges into the current doc), this opens the file as its own document. Pass `make_active:true` (default) to switch focus to the loaded document. Differs from `import_scene` which calls MergeDocument.",
  inputShape: {
    path: z.string().describe("Absolute path to a loadable scene file."),
    make_active: z
      .boolean()
      .optional()
      .describe("Switch the active document to the newly loaded one. Default true."),
  },
  async handler(args, client) {
    return textResult(await client.request("open_document", args, 60_000));
  },
});
