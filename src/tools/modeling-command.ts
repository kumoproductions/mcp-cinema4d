import { z } from "zod";
import { defineTool, textResult } from "./define-tool.js";
import { handleSchema } from "./handle.js";

export const modelingCommandTool = defineTool({
  name: "modeling_command",
  group: "modeling",
  title: "Modeling Command",
  description:
    "Run a Cinema 4D modeling operation via c4d.utils.SendModelingCommand on one or more target objects. Commands that produce new geometry (Current State to Object, Connect / Join, Split, Explode Segments) return handles to the inserted results; in-place commands (Make Editable, Subdivide, Triangulate, …) return the mutated targets. Aliases: current_state_to_object / cso, make_editable, connect / join, connect_delete, subdivide, triangulate, untriangulate, reverse_normals, align_normals, optimize, center_axis, split, explode_segments, melt, collapse, dissolve.",
  inputShape: {
    command: z
      .union([z.string(), z.number().int()])
      .describe("Alias (see description) or raw MCOMMAND_* integer."),
    targets: z.array(handleSchema).min(1).describe("Target object handles."),
    mode: z
      .enum(["all", "edge", "point", "poly", "polygon"])
      .optional()
      .describe("MODELINGCOMMANDMODE_* selector. Default 'all'."),
    params: z
      .record(z.string(), z.union([z.boolean(), z.number(), z.string(), z.array(z.number())]))
      .optional()
      .describe("Optional BaseContainer params for the command (e.g. subdivision level)."),
  },
  async handler(args, client) {
    return textResult(await client.request("modeling_command", args, 30_000));
  },
});
