import { z } from "zod";
import { defineTool, textResult } from "./define-tool.js";
import { handleDescription, handleSchema } from "./handle.js";

// Each path segment is one of:
//   - an int id (common case)
//   - "x" | "y" | "z" (vector sub-component)
//   - [id, "real"|"long"|"bool"|"vector"] (explicit dtype alias)
//   - [id, dtype_int, creator_int] (bridge-internal DescLevel echo, emitted
//     by list_user_data so callers can pipe that shape straight back)
const pathSegment = z.union([
  z.number().int(),
  z.enum(["x", "y", "z"]),
  z.tuple([z.union([z.number().int(), z.enum(["x", "y", "z"])]), z.string()]),
  z.array(z.number().int()).min(2).max(3),
]);

const pathSchema = z.union([z.number().int(), z.array(pathSegment).min(1)]);

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
