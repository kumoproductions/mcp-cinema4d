import { z } from "zod";
import { defineTool, textResult } from "./define-tool.js";
import { handleSchema } from "./handle.js";

export const setTransformTool = defineTool({
  name: "set_transform",
  group: "transforms",
  title: "Set Object Transform",
  description:
    "Write an object's transform in local or global space. Pass any combination of `pos`/`rot` (HPB radians)/`scale` to patch individual components — unspecified parts keep their current value. Or pass a full 4x3 `matrix` (rows: offset, v1, v2, v3) to replace the whole transform; matrix is mutually exclusive with the decomposed fields. Space defaults to 'local' (SetMl). Use 'global' (SetMg) to write world coordinates through a parent.",
  inputShape: {
    handle: handleSchema.describe("Target object."),
    pos: z.tuple([z.number(), z.number(), z.number()]).optional().describe("[x, y, z]."),
    rot: z
      .tuple([z.number(), z.number(), z.number()])
      .optional()
      .describe("[heading, pitch, bank] in radians."),
    scale: z.tuple([z.number(), z.number(), z.number()]).optional().describe("[sx, sy, sz]."),
    matrix: z
      .array(z.tuple([z.number(), z.number(), z.number()]))
      .length(4)
      .optional()
      .describe("4x3 matrix as [offset, v1, v2, v3]. Exclusive with pos/rot/scale."),
    space: z.enum(["local", "global"]).optional().describe("Default 'local'."),
  },
  async handler(args, client) {
    return textResult(await client.request("set_transform", args, 10_000));
  },
});
