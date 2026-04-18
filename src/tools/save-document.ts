import { z } from "zod";
import { defineTool, textResult } from "./define-tool.js";

export const saveDocumentTool = defineTool({
  name: "save_document",
  group: "document-io",
  title: "Save Document",
  description:
    "Save the active document to disk. Path must be absolute; the parent directory must exist. Supported formats: c4d (default), abc / alembic, fbx, obj, stl, ply, usd / usda, gltf. With `copy:true` the document's internal name/path is left unchanged (Save-As-Copy behaviour).",
  inputShape: {
    path: z.string().describe("Absolute output path."),
    format: z
      .enum(["c4d", "abc", "alembic", "fbx", "obj", "stl", "ply", "usd", "usda", "gltf"])
      .optional()
      .describe("Export format alias. Default 'c4d'."),
    copy: z
      .boolean()
      .optional()
      .describe("Save as copy — document's active path/name stays unchanged. Default false."),
  },
  async handler(args, client) {
    return textResult(await client.request("save_document", args, 60_000));
  },
});
