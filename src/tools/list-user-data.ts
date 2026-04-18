import { defineTool, textResult } from "./define-tool.js";
import { handleSchema } from "./handle.js";

export const listUserDataTool = defineTool({
  name: "list_user_data",
  group: "user-data",
  title: "List User Data",
  description:
    "Enumerate the User Data slots on a target. Each entry carries `{desc_id, name, dtype, value}`. Feed `desc_id` back into `remove_user_data` / `get_params` / `set_params` as a DescID path.",
  inputShape: {
    handle: handleSchema.describe("Target to inspect."),
  },
  async handler(args, client) {
    return textResult(await client.request("list_user_data", args, 10_000));
  },
});
