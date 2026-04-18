import { defineTool, textResult } from "./define-tool.js";

export const getDocumentStateTool = defineTool({
  name: "get_document_state",
  group: "shot",
  title: "Get Document State",
  description:
    "One-shot reader for the active document's key fields: fps, min/max and loop frame range, current frame, document name/path, and canonical handles for the active camera / take / render data. Pairs with `set_document` for the writer side.",
  inputShape: {},
  async handler(_args, client) {
    return textResult(await client.request("get_document_state", {}, 5_000));
  },
});
