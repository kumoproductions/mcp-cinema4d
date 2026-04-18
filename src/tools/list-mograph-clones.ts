import { z } from "zod";
import { defineTool, textResult } from "./define-tool.js";
import { handleSchema } from "./handle.js";

export const listMographClonesTool = defineTool({
  name: "list_mograph_clones",
  group: "mograph",
  title: "List MoGraph Clones",
  description:
    "Read the per-clone transforms from a MoGraph generator (Cloner / Matrix / Tracer / …). The bridge forces a scene pass so the MoData array is populated before sampling. Returns `{count, returned, clones: [{index, pos, matrix?}]}`. `supported:false` when the build lacks c4d.modules.mograph or when the handle isn't a MoGraph generator.",
  inputShape: {
    handle: handleSchema.describe("MoGraph generator (e.g. Omgcloner)."),
    max_count: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Cap on clones returned. Default 2048."),
    include_matrix: z
      .boolean()
      .optional()
      .describe("Include the 4x3 matrix per clone. Default true."),
  },
  async handler(args, client) {
    return textResult(await client.request("list_mograph_clones", args, 20_000));
  },
});
