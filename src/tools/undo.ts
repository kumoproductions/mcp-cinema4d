import { z } from "zod";
import { defineTool, textResult } from "./define-tool.js";

export const undoTool = defineTool({
  name: "undo",
  group: "script",
  title: "Pop Undo Stack",
  description:
    "Pop up to `steps` entries off the active document's undo stack via doc.DoUndo. Stops early if the stack empties. Returns `steps_performed` so callers can tell when fewer steps were available than requested. Default: 1 step.",
  inputShape: {
    steps: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Number of undo steps to perform (default 1)."),
  },
  async handler(args, client) {
    const payload: Record<string, unknown> = {};
    if (args.steps !== undefined) payload.steps = args.steps;
    return textResult(await client.request("undo", payload, 10_000));
  },
});
