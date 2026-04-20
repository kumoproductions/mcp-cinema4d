import { z } from "zod";
import { defineTool, textResult } from "./define-tool.js";
import { handleSchema } from "./handle.js";

const pathSegment = z.union([
  z.number().int(),
  z.enum(["x", "y", "z"]),
  z.tuple([z.union([z.number().int(), z.enum(["x", "y", "z"])]), z.string()]),
  z.array(z.number().int()).min(2).max(3),
]);

const pathSchema = z.union([z.number().int(), z.array(pathSegment).min(1)]);

export const takeOverrideTool = defineTool({
  name: "take_override",
  group: "shot",
  title: "Write Take Parameter Overrides",
  description:
    "Write per-Take parameter overrides onto a target node (object / tag / material / render_data / video_post / shader). Wraps `take.OverrideNode + UpdateSceneNode + override[descid] = value`. Use this for shot-by-shot variations that share a single scene (e.g. override Focal Length per Take while one Camera is reused). Paths use the same syntax as `set_params`.",
  inputShape: {
    take: z.string().describe("Take name (must not be Main)."),
    target: handleSchema.describe("Handle of the node to override."),
    values: z
      .array(
        z.object({
          path: pathSchema,
          value: z.union([z.boolean(), z.number(), z.string(), z.array(z.number())]),
        }),
      )
      .optional()
      .describe("Override writes — same path syntax as set_params."),
    params: z
      .record(z.string(), z.union([z.boolean(), z.number(), z.string(), z.array(z.number())]))
      .optional()
      .describe("Shorthand {pid: value} for flat writes (applied after `values`)."),
    clear: z
      .array(pathSchema)
      .optional()
      .describe("Paths to drop from the override (parameter reverts to scene value)."),
    remove_all: z
      .boolean()
      .optional()
      .describe("Drop the entire override for this target on this Take."),
  },
  async handler(args, client) {
    return textResult(await client.request("take_override", args, 15_000));
  },
});
