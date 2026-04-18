import { z } from "zod";
import { defineTool, textResult } from "./define-tool.js";

export const callCommandTool = defineTool({
  name: "call_command",
  group: "script",
  title: "Call C4D Command",
  description:
    "Invoke a Cinema 4D command by plugin id via c4d.CallCommand(). Works for built-in commands (render, save, make editable, ...) and any registered command plugin.",
  inputShape: {
    command_id: z
      .number()
      .int()
      .describe(
        'Cinema 4D command id. Examples: 12099 = Render to Picture Viewer, 12161 = Save Document, 12236 = Make Editable, 12168 = New Document. Use list_plugins (plugin_type="command") to discover.',
      ),
    subid: z.number().int().optional().describe("Optional sub-id (rarely needed)."),
    timeout_ms: z
      .number()
      .int()
      .positive()
      .optional()
      .describe(
        "Request timeout in ms (default 60000). CallCommand often runs synchronously; increase for long-running ones like Render.",
      ),
  },
  async handler(args, client) {
    const timeout = args.timeout_ms ?? 60_000;
    const payload: Record<string, unknown> = { command_id: args.command_id };
    if (args.subid !== undefined) payload.subid = args.subid;
    return textResult(await client.request("call_command", payload, timeout));
  },
});
