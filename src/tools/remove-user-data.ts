import { z } from "zod";
import { defineTool, textResult } from "./define-tool.js";
import { handleSchema } from "./handle.js";

export const removeUserDataTool = defineTool({
  name: "remove_user_data",
  group: "user-data",
  title: "Remove User Data Slot",
  description:
    "Delete a User Data slot by its DescID path (as returned by `list_user_data` or `add_user_data`). Wrapped in undo.",
  inputShape: {
    handle: handleSchema.describe("Target."),
    desc_id: z
      .array(z.array(z.number().int()).min(2).max(3))
      .describe("DescID path — list of [id, dtype, creator?] levels."),
  },
  async handler(args, client) {
    return textResult(await client.request("remove_user_data", args, 10_000));
  },
});
