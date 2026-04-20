import { z } from "zod";
import { defineTool, textResult } from "./define-tool.js";
import { handleSchema } from "./handle.js";

export const createEntityTool = defineTool({
  name: "create_entity",
  group: "crud",
  title: "Create C4D Entity",
  description:
    'Unified constructor for object / tag / material / shader / video_post. Handles parent linking, optional params, positions, and container slot assignment in one call. Returns the handle of the created entity (object handles include `path` for stable re-resolution) so you can chain set_params / set_keyframe. Note: `kind:"shader"` targets classical shader chains (Fusion, Colorizer, Xbitmap, …). For node-material edits (Standard node space / Redshift), use `apply_graph_description` instead. `kind:"video_post"` attaches a renderer effect (Octane 1029525, Redshift 1036219, Magic Bullet Looks 1054755, …) to a RenderData parent.',
  inputShape: {
    kind: z
      .enum(["object", "tag", "material", "shader", "video_post"])
      .describe("Entity kind to create."),
    type_id: z
      .union([z.number().int(), z.string()])
      .describe(
        "Plugin id. Accepts a numeric id (c4d.Ocube=5159, c4d.Ttexture=5616, Octane renderer=1029525, …) or, for kind='object', an alias string: 'cube', 'sphere', 'cylinder', 'cone', 'torus', 'plane', 'disc', 'pyramid', 'platonic', 'null'.",
      ),
    name: z.string().optional().describe("Optional display name."),
    parent: handleSchema
      .optional()
      .describe(
        "Parent handle. Required for tag (owner object), shader (owner VideoPost / tag / material) and video_post (owner render_data). Optional for object (creates at scene root if omitted).",
      ),
    params: z
      .record(z.string(), z.union([z.boolean(), z.number(), z.string(), z.array(z.number())]))
      .optional()
      .describe("{param_id: value} to set after allocation. Lists of 3 numbers become Vectors."),
    position: z
      .tuple([z.number(), z.number(), z.number()])
      .optional()
      .describe("Relative position [x,y,z] (objects only)."),
    slots: z
      .array(z.number().int())
      .optional()
      .describe(
        "Owner BaseContainer slot ids to link the new shader into (e.g. [3740, 3741] for Octane AOV).",
      ),
  },
  async handler(args, client) {
    return textResult(await client.request("create_entity", args, 15_000));
  },
});
