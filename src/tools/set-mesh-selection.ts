import { z } from "zod";
import { defineTool, textResult } from "./define-tool.js";
import { handleSchema } from "./handle.js";

export const setMeshSelectionTool = defineTool({
  name: "set_mesh_selection",
  group: "mesh",
  title: "Set Mesh Selection",
  description:
    "Replace the point / polygon / edge BaseSelect on an editable mesh. Existing selection of the specified kind is cleared first. Pair with `get_mesh` using `include:['selections']` to read the same channels back. " +
    "Bulk path: dense index lists are run-length compressed and applied via `BaseSelect.SelectAll(start, end)` ranges, so a 50,000-poly mesh takes a single-digit ms instead of seconds. " +
    "Use `mode: 'set_except'` to select everything except the given indices — handy for the split-by-deletion pattern (delete polygons NOT in keep_set) without computing the inverse in the caller.",
  inputShape: {
    handle: handleSchema.describe("Editable target (PointObject / PolygonObject)."),
    kind: z.enum(["point", "polygon", "edge"]).describe("Which selection channel to replace."),
    indices: z
      .array(z.number().int().nonnegative())
      .describe(
        "Indices to mark selected (when mode='set') or to EXCLUDE (when mode='set_except').",
      ),
    mode: z
      .enum(["set", "set_except"])
      .optional()
      .describe(
        "'set' (default) selects the given indices. 'set_except' selects every component EXCEPT the given indices, in [0, total).",
      ),
  },
  async handler(args, client) {
    return textResult(await client.request("set_mesh_selection", args, 30_000));
  },
});
