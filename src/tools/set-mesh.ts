import { z } from "zod";
import { defineTool, textResult } from "./define-tool.js";
import { handleSchema } from "./handle.js";

export const setMeshTool = defineTool({
  name: "set_mesh",
  group: "mesh",
  title: "Set Mesh",
  description:
    "Overwrite the points (and optionally polygons) of an editable object. Triangles may be passed as [a,b,c]; the bridge expands them to C4D's quad storage (a,b,c,c). If polygons is omitted, only points are rewritten and the count must match the existing topology. Wrapped in a single undo entry.",
  inputShape: {
    handle: handleSchema.describe("Target editable object."),
    points: z.array(z.tuple([z.number(), z.number(), z.number()])).describe("New point positions."),
    polygons: z
      .array(z.array(z.number().int()).min(3).max(4))
      .optional()
      .describe("New polygon indices. [a,b,c] = triangle, [a,b,c,d] = quad."),
  },
  async handler(args, client) {
    return textResult(await client.request("set_mesh", args, 30_000));
  },
});
