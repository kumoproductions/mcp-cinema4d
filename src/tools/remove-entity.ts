import { defineTool, textResult } from "./define-tool.js";
import { handleSchema } from "./handle.js";

export const removeEntityTool = defineTool({
  name: "remove_entity",
  group: "crud",
  title: "Remove C4D Entity",
  description: "Delete the resolved entity (wrapped in an undo step).",
  inputShape: {
    handle: handleSchema.describe("Entity to delete."),
  },
  async handler(args, client) {
    return textResult(await client.request("remove_entity", { handle: args.handle }, 10_000));
  },
});
