import { defineTool, textResult } from "./define-tool.js";

export const getSelectionTool = defineTool({
  name: "get_selection",
  group: "selection",
  title: "Get Active Selection",
  description:
    "Read the active document's current selection: the active object (primary), all selected objects, and the active tag / material. Useful for reacting to the user's current focus without asking them to re-pick entities. Returns canonical handles so results can be piped directly into describe / set_params / etc.",
  inputShape: {},
  async handler(_args, client) {
    return textResult(await client.request("get_selection", {}, 5_000));
  },
});
