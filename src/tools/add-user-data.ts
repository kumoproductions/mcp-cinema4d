import { z } from "zod";
import { defineTool, textResult } from "./define-tool.js";
import { handleSchema } from "./handle.js";

export const addUserDataTool = defineTool({
  name: "add_user_data",
  group: "user-data",
  title: "Add User Data Slot",
  description:
    "Add a new User Data slot to any BaseList2D (common rigging / control-exposure pattern). Returns the slot's DescID (as a nested list) which can be piped into `get_params` / `set_params` as a path. dtype aliases: real, long, bool, vector, string, color, filename, time, link.",
  inputShape: {
    handle: handleSchema.describe("Target (object / tag / material / etc.)."),
    name: z.string().describe("Display name for the new UD slot."),
    dtype: z
      .enum(["real", "long", "bool", "vector", "string", "color", "filename", "time", "link"])
      .describe("User-data dtype."),
    value: z
      .union([z.boolean(), z.number(), z.string(), z.array(z.number())])
      .optional()
      .describe("Initial value. For vector / color, pass [x,y,z]."),
    default: z
      .union([z.boolean(), z.number(), z.string(), z.array(z.number())])
      .optional()
      .describe("Default stored on the descriptor."),
    min: z.number().optional().describe("Numeric lower bound (real / long)."),
    max: z.number().optional().describe("Numeric upper bound (real / long)."),
    step: z.number().optional().describe("Spinner step size."),
  },
  async handler(args, client) {
    return textResult(await client.request("add_user_data", args, 10_000));
  },
});
