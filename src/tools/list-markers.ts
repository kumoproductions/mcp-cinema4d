import { defineTool, textResult } from "./define-tool.js";

export const listMarkersTool = defineTool({
  name: "list_markers",
  group: "shot",
  title: "List Timeline Markers",
  description:
    "Enumerate every timeline marker in the active document with its frame, time_seconds, name, colour and length_frames (c4d.documents.GetFirstMarker + GetNext). Each entry carries an `index` handle accepted by set_marker / remove_marker. Use this to verify marker placement — get_document_state only reports marker_count.",
  inputShape: {},
  async handler(_args, client) {
    return textResult(await client.request("list_markers", {}, 15_000));
  },
});
