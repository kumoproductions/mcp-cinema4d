import { z } from "zod";
import { defineTool, textResult } from "./define-tool.js";
import { handleSchema } from "./handle.js";

export const connectPolygonObjectsTool = defineTool({
  name: "connect_polygon_objects",
  group: "modeling",
  title: "Connect Polygon Objects (polygon-preserving)",
  description:
    "Merge multiple PolygonObjects into a single PolygonObject with a guaranteed-no-polygon-loss assertion. " +
    "Built because `c4d.utils.SendModelingCommand(MCOMMAND_JOIN)` silently drops polygons on PolygonObject inputs in C4D 2026 — it returns one input as the 'merged' output, losing everything else. " +
    "Internally aggregates point/polygon arrays in Python (in world space by default), creates a fresh PolygonObject sized to fit, and asserts that input total polygon count == output polygon count — raises with a clear error if they diverge. " +
    "Does NOT carry over UVW / Phong / Selection / Vertex Color tags; reapply textures and `assign_material` afterwards. When vertex attributes must be preserved, look up the GUI 'Connect Objects + Delete' command id via `list_plugins(plugin_type=\"command\")` and run it via `call_command(command_id=<id>, selected_objects=[...])` — its id has drifted across releases, so name-based discovery is the safe path.",
  inputShape: {
    objects: z
      .array(handleSchema)
      .min(2)
      .describe("PolygonObject handles to merge (must be >= 2)."),
    delete_originals: z
      .boolean()
      .optional()
      .describe(
        "Remove the input objects after a successful merge. Default true (matches GUI command 12099 'Connect Objects + Delete'). Set false to keep the originals as a backup.",
      ),
    target_parent: handleSchema
      .optional()
      .describe(
        "Object handle to insert the merged result under. Default: parent of the first input object. Pass an explicit Null to keep the merged building grouped at a known location.",
      ),
    target_name: z
      .string()
      .optional()
      .describe(
        "Name for the merged PolygonObject. Default: the first input's name with a `_merged` suffix.",
      ),
    preserve_world_position: z
      .boolean()
      .optional()
      .describe(
        "Apply each source object's world matrix to its points before aggregation, so the merged mesh stays at the same world position. Default true. Set false only when all inputs are guaranteed to share the same parent transform.",
      ),
    timeout_ms: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Request timeout in ms (default 120000). Increase for very large meshes."),
  },
  async handler(args, client) {
    const timeout = args.timeout_ms ?? 120_000;
    const payload: Record<string, unknown> = { objects: args.objects };
    if (args.delete_originals !== undefined) payload.delete_originals = args.delete_originals;
    if (args.target_parent !== undefined) payload.target_parent = args.target_parent;
    if (args.target_name !== undefined) payload.target_name = args.target_name;
    if (args.preserve_world_position !== undefined)
      payload.preserve_world_position = args.preserve_world_position;
    return textResult(await client.request("connect_polygon_objects", payload, timeout));
  },
});
