import { z } from "zod";
import { defineTool, textResult } from "./define-tool.js";
import { handleSchema } from "./handle.js";

export const setMeshSelectionTool = defineTool({
  name: "set_mesh_selection",
  group: "mesh",
  title: "Set Mesh Selection",
  description:
    "Replace the point / polygon / edge BaseSelect on an editable mesh. Existing selection of the specified kind is cleared first. Pair with `get_mesh` using `include:['selections']` to read the same channels back.",
  inputShape: {
    handle: handleSchema.describe("Editable target (PointObject / PolygonObject)."),
    kind: z.enum(["point", "polygon", "edge"]).describe("Which selection channel to replace."),
    indices: z.array(z.number().int().nonnegative()).describe("Indices to mark selected."),
  },
  async handler(args, client) {
    return textResult(await client.request("set_mesh_selection", args, 15_000));
  },
});
