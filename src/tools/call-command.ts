import { z } from "zod";
import { defineTool, textResult } from "./define-tool.js";
import { handleSchema } from "./handle.js";

export const callCommandTool = defineTool({
  name: "call_command",
  group: "script",
  title: "Call C4D Command",
  description:
    "Invoke a Cinema 4D command by plugin id via c4d.CallCommand(). Works for built-in commands (render, save, make editable, ...) and any registered command plugin. " +
    "**Headless selection:** many GUI commands (e.g. 12099 Connect Objects + Delete) read the current active-object selection. Setting it from a script alone may not propagate before the command runs. Pass `selected_objects` to have the bridge call SetActiveObject for each handle and EventAdd-flush before invoking the command — the response then reports `active_after` so you can pick up the produced object.",
  inputShape: {
    command_id: z
      .number()
      .int()
      .describe(
        "Cinema 4D command id. Examples: 12099 = Render to Picture Viewer, 12161 = Save Document, 12236 = Make Editable, 12168 = New Document. " +
          'Use `list_plugins(plugin_type="command")` to discover ids by name. ' +
          "Note: command ids drift between C4D releases — verify with `c4d.GetCommandName(<id>)` (via exec_python) before relying on a hard-coded id.",
      ),
    subid: z.number().int().optional().describe("Optional sub-id (rarely needed)."),
    selected_objects: z
      .array(handleSchema)
      .optional()
      .describe(
        "Establish the active-object selection before invoking the command. The bridge calls SetActiveObject(SELECTION_NEW) for the first handle, SELECTION_ADD for the rest, runs EventAdd to flush, then runs the command. Use this for selection-driven commands like 12099 (Connect+Delete) — script-set selection without a flush is not reliably picked up by the GUI command path.",
      ),
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
    if (args.selected_objects !== undefined) payload.selected_objects = args.selected_objects;
    return textResult(await client.request("call_command", payload, timeout));
  },
});
