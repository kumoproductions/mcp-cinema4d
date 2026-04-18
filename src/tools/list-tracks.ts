import { defineTool, textResult } from "./define-tool.js";
import { handleSchema } from "./handle.js";

export const listTracksTool = defineTool({
  name: "list_tracks",
  group: "animation",
  title: "List Animation Tracks",
  description:
    "Enumerate CTracks on the resolved entity. Returns `{name, param_id, component, dtype, key_count}` per track so callers can pipe the results straight into get_keyframes / set_keyframe. Vector tracks (Position, Rotation, Scale) surface as separate entries per component.",
  inputShape: {
    handle: handleSchema.describe("Entity whose animation tracks to enumerate."),
  },
  async handler(args, client) {
    return textResult(await client.request("list_tracks", args, 10_000));
  },
});
