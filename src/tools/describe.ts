import { defineTool, textResult } from "./define-tool.js";
import { handleDescription, handleSchema } from "./handle.js";

export const describeTool = defineTool({
  name: "describe",
  group: "crud",
  title: "Describe C4D Entity",
  description:
    "Dump all description parameters (id, name, cycle enum, current value) of a C4D entity resolved by handle. Use this to discover parameter IDs before reading/writing.",
  inputShape: {
    handle: handleSchema.describe(handleDescription),
  },
  async handler(args, client) {
    return textResult(await client.request("describe", { handle: args.handle }, 15_000));
  },
});
