import { z } from "zod";
import { defineTool, textResult } from "./define-tool.js";
import { handleSchema } from "./handle.js";

export const importSceneTool = defineTool({
  name: "import_scene",
  group: "shot",
  title: "Import / Merge Scene File",
  description:
    "Merge an external file (abc/fbx/obj/c4d/etc.) into the active document via MergeDocument. Returns the newly-imported top-level objects so they can be chained with set_params / create_entity / create_take. Optionally re-parents them under an existing object and renames the first root.",
  inputShape: {
    path: z.string().describe("Absolute path to the file to merge (abc/fbx/obj/c4d/...)."),
    filter: z
      .enum(["objects", "materials", "all"])
      .optional()
      .describe('Scene filter (default "all").'),
    parent: handleSchema
      .optional()
      .describe(
        "Optional parent handle — newly-imported top-level objects are moved under this object.",
      ),
    rename: z
      .string()
      .optional()
      .describe("Optional new name for the first imported top-level object."),
  },
  async handler(args, client) {
    return textResult(await client.request("import_scene", args, 120_000));
  },
});
