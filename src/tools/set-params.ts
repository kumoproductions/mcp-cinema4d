import { z } from "zod";
import { defineTool, textResult } from "./define-tool.js";
import { handleDescription, handleSchema, pathSchema } from "./handle.js";

export const setParamsTool = defineTool({
  name: "set_params",
  group: "crud",
  title: "Set Parameter Values",
  description:
    "Atomically write parameter values (wrapped in one undo). Each entry is `{path, value}` where `path` is either an int id or a DescID path (e.g. [903, 'x'] = position.x). Lists of 3 numbers auto-coerce into c4d.Vector for vector-typed destinations. Returns `{applied: [{path, value}], errors: [{path, error}]}`.",
  inputShape: {
    handle: handleSchema.describe(handleDescription),
    values: z
      .array(
        z.object({
          path: pathSchema,
          value: z.union([z.boolean(), z.number(), z.string(), z.array(z.number())]),
        }),
      )
      .describe("Writes to apply. Wrapped in an undo group."),
  },
  async handler(args, client) {
    return textResult(
      await client.request("set_params", { handle: args.handle, values: args.values }, 15_000),
    );
  },
});
