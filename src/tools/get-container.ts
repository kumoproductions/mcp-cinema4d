import { z } from "zod";
import { defineTool, textResult } from "./define-tool.js";
import { handleDescription, handleSchema } from "./handle.js";

export const getContainerTool = defineTool({
  name: "get_container",
  group: "crud",
  title: "Dump Raw BaseContainer",
  description:
    "Dump the raw BaseContainer of a C4D entity (including hidden keys that don't show up in `describe`, e.g. Octane AOV shader slots at 3740/3741). Filter by key range to narrow output.",
  inputShape: {
    handle: handleSchema.describe(handleDescription),
    id_from: z.number().int().optional().describe("Inclusive lower bound for container keys."),
    id_to: z.number().int().optional().describe("Inclusive upper bound for container keys."),
  },
  async handler(args, client) {
    const params: Record<string, unknown> = { handle: args.handle };
    if (args.id_from !== undefined) params.id_from = args.id_from;
    if (args.id_to !== undefined) params.id_to = args.id_to;
    return textResult(await client.request("get_container", params, 15_000));
  },
});
