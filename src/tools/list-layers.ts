import { defineTool, textResult } from "./define-tool.js";

export const listLayersTool = defineTool({
  name: "list_layers",
  group: "layers",
  title: "List Layers",
  description:
    "Enumerate every LayerObject in the active document. Each entry returns the layer's name, optional color [r,g,b], and its flag dict (solo / view / render / manager / locked / generators / deformers / expressions / animation / xref).",
  inputShape: {},
  async handler(_args, client) {
    return textResult(await client.request("list_layers", {}, 10_000));
  },
});
