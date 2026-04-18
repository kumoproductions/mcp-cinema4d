import { z } from "zod";
import { defineTool, textResult } from "./define-tool.js";
import { handleSchema } from "./handle.js";

export const assignMaterialTool = defineTool({
  name: "assign_material",
  group: "tags",
  title: "Assign Material (Texture Tag)",
  description:
    "Link a material to an object by creating a Texture tag (or updating an existing one when `update_if_exists:true`). Avoids wrangling TEXTURETAG_* param ids by hand. Projection aliases: spherical, cylindrical, flat, cubic, frontal, spatial, uvw, shrinkwrap, camera.",
  inputShape: {
    object: handleSchema.describe("Target object."),
    material: handleSchema.describe("Material to assign."),
    projection: z
      .enum([
        "spherical",
        "cylindrical",
        "flat",
        "cubic",
        "frontal",
        "spatial",
        "uvw",
        "shrinkwrap",
        "camera",
      ])
      .optional()
      .describe("Projection alias. Omit to preserve the existing projection."),
    uv_offset: z
      .tuple([z.number(), z.number()])
      .optional()
      .describe("[u, v] offset applied to TEXTURETAG_OFFSETX/Y."),
    uv_tiles: z
      .tuple([z.number(), z.number()])
      .optional()
      .describe("[u, v] tile count applied to TEXTURETAG_TILESX/Y."),
    restrict_to_selection: z
      .string()
      .optional()
      .describe("Polygon-selection tag name to restrict this texture to."),
    update_if_exists: z
      .boolean()
      .optional()
      .describe(
        "If a Texture tag already exists on the object, update it in place instead of appending. Default false.",
      ),
    name: z.string().optional().describe("Optional display name for the Texture tag."),
  },
  async handler(args, client) {
    return textResult(await client.request("assign_material", args, 10_000));
  },
});
