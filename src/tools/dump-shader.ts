import { z } from "zod";
import { defineTool, textResult } from "./define-tool.js";
import { handleDescription, handleSchema } from "./handle.js";

export const dumpShaderTool = defineTool({
  name: "dump_shader",
  group: "crud",
  title: "Dump Shader Tree",
  description:
    'Recursively dump a shader (resolved from a handle) into JSON. **Classical materials only** — node materials (Standard node space / Redshift / etc.) expose their shading as a maxon node graph; use `list_graph_nodes` / `apply_graph_description` for those instead. Captures type_id / type_name / name per node; promotes c4d.Xbitmap paths to a "file" field; heuristically surfaces image-like strings hiding in other shader BaseContainers as "file_candidates"; and expands shader links stored inside the container as "linked_shaders" (the shape used by Fusion / Colorizer whose internals don\'t appear via GetDown). Pair with list_entities kind=shader to discover shader handles.',
  inputShape: {
    handle: handleSchema.describe(
      `${handleDescription} For this tool, pass a shader handle such as {kind:"shader", owner:<material handle>, index:0}.`,
    ),
    max_depth: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe("Maximum recursion depth (default 5). 0 returns only the root node."),
  },
  async handler(args, client) {
    const payload: Record<string, unknown> = { handle: args.handle };
    if (args.max_depth !== undefined) payload.max_depth = args.max_depth;
    return textResult(await client.request("dump_shader", payload, 15_000));
  },
});
