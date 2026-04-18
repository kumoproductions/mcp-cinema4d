import { z } from "zod";
import { defineTool, textResult } from "./define-tool.js";
import { handleSchema } from "./handle.js";

export const getMeshTool = defineTool({
  name: "get_mesh",
  group: "mesh",
  title: "Get Mesh",
  description:
    "Read points and polygons (or spline segments) from an editable PointObject / PolygonObject / SplineObject. Primitives (Cube, Sphere, …) must be converted first via `modeling_command` make_editable. Triangles are returned as [a,b,c] (c==d in C4D storage), quads as [a,b,c,d]. Point and polygon counts are capped to 50,000 by default to protect JSON payload size — override via max_points / max_polys.",
  inputShape: {
    handle: handleSchema.describe("Target object (must be editable)."),
    max_points: z.number().int().positive().optional().describe("Default 50000."),
    max_polys: z.number().int().positive().optional().describe("Default 50000."),
    include: z
      .array(z.enum(["normals", "selections"]))
      .optional()
      .describe(
        "Optional extras. 'normals' adds phong-shaded vertex normals. 'selections' adds `point_selection` / `poly_selection` / `edge_selection` index lists.",
      ),
  },
  async handler(args, client) {
    return textResult(await client.request("get_mesh", args, 20_000));
  },
});
