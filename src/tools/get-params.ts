import { z } from "zod";
import { defineTool, textResult } from "./define-tool.js";
import { handleDescription, handleSchema, pathSchema } from "./handle.js";

export const getParamsTool = defineTool({
  name: "get_params",
  group: "crud",
  title: "Get Parameter Values",
  description:
    "Read parameter values on a C4D entity by id or DescID path. Each id may be: an int (top-level), a list [a, b, …] (chained DescID; dtypes inferred from the description), or contain 'x'/'y'/'z' for vector sub-components (e.g. [903, 'x'] = position.x). For explicit dtypes use [[id, 'real|long|bool|vector'], …]. Returns `{values: [{path, value}]}` in request order. Discover ids via `describe`.",
  inputShape: {
    handle: handleSchema.describe(handleDescription),
    ids: z.array(pathSchema).describe("List of parameter paths to read."),
  },
  async handler(args, client) {
    return textResult(
      await client.request("get_params", { handle: args.handle, ids: args.ids }, 10_000),
    );
  },
});
