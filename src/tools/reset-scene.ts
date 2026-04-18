import { z } from "zod";
import { defineTool, textResult } from "./define-tool.js";

export const resetSceneTool = defineTool({
  name: "reset_scene",
  group: "basics",
  title: "Reset Active Scene",
  description:
    "Clear scene state in one RPC. With `prefix` (e.g. 'e2e_') removes only objects / materials / non-active render data / non-main takes whose name starts with the prefix, then flushes the undo buffer — cheap cleanup for test suites. Without prefix, swaps the active document for a fresh empty BaseDocument (everything goes). Much faster than chained remove_entity calls when cleanup involves animated objects.",
  inputShape: {
    prefix: z
      .string()
      .optional()
      .describe("Only remove entities whose name starts with this prefix. Omit for full reset."),
    keep_active_rd: z
      .boolean()
      .optional()
      .describe(
        "Prefix-mode only: protect the currently-active RenderData from deletion. Default true.",
      ),
  },
  async handler(args, client) {
    return textResult(await client.request("reset_scene", args, 30_000));
  },
});
